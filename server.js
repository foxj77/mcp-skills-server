#!/usr/bin/env node
/**
 * MCP skills server — zero-dependency implementation over stdio.
 *
 * MCP is JSON-RPC 2.0 over newline-delimited stdio. Each message from
 * supergateway arrives as one JSON line on stdin; each response is one JSON
 * line on stdout. No SDK required.
 *
 * Skills are scanned from SKILLS_DIR at startup. Tool content is re-read from
 * disk on every call (lazy reload) so updated skill bodies are served without
 * a restart. New skills added after startup require a pod restart to appear in
 * tools/list — known v1 limitation.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const SKILLS_DIR = process.env.SKILLS_DIR || '/skills';
const SERVER_NAME = process.env.SERVER_NAME || 'mcp-skills-server';

/** Parse SKILL.md — returns { frontmatter, body }. */
function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.startsWith('---')) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (match) {
      const fm = {};
      for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      return { frontmatter: fm, body: match[2].trim() };
    }
  }
  return { frontmatter: {}, body: content.trim() };
}

/** Scan SKILLS_DIR at startup — returns Map<name, {description, skillFile}>. */
function loadSkills() {
  const skills = new Map();
  if (!fs.existsSync(SKILLS_DIR)) {
    process.stderr.write(`SKILLS_DIR ${SKILLS_DIR} does not exist — no skills loaded\n`);
    return skills;
  }
  for (const entry of fs.readdirSync(SKILLS_DIR).sort()) {
    const skillDir = path.join(SKILLS_DIR, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');
    try {
      if (fs.statSync(skillDir).isDirectory() && fs.existsSync(skillFile)) {
        const { frontmatter } = parseSkillFile(skillFile);
        const name = frontmatter.name || entry;
        const description = frontmatter.description || `Skill: ${name}`;
        skills.set(name, { description, skillFile });
        process.stderr.write(`registered skill: ${name}\n`);
      }
    } catch (err) {
      process.stderr.write(`skipping ${entry}: ${err.message}\n`);
    }
  }
  return skills;
}

const skills = loadSkills();
process.stderr.write(`startup scan complete: ${skills.size} skill(s) registered\n`);

/** Send a JSON-RPC response to stdout. */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/** Build the tools list. */
function toolsList() {
  return Array.from(skills.entries()).map(([name, { description }]) => ({
    name,
    description,
    inputSchema: { type: 'object', properties: {}, required: [] },
  }));
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // ignore unparseable input
  }

  // Notifications have no id and need no response.
  if (msg.id === undefined && msg.method !== undefined) return;

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: '1.0.0' },
        },
      });
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: toolsList() } });
      break;

    case 'tools/call': {
      const name = msg.params?.name;
      if (!skills.has(name)) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown skill: ${name}` } });
      } else {
        // Lazy reload: re-read from disk on every call.
        const { body } = parseSkillFile(skills.get(name).skillFile);
        send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: body }] } });
      }
      break;
    }

    default:
      if (msg.id !== undefined) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      }
  }
});

rl.on('close', () => process.exit(0));
