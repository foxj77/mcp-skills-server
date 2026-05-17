#!/usr/bin/env node
/**
 * MCP skills server — exposes skills from a Git-synced directory as MCP tools.
 *
 * Each subdirectory under SKILLS_DIR containing a SKILL.md with YAML frontmatter
 * (name, description) is registered as an MCP tool. Tool content is re-read from
 * disk on every call (lazy reload) so updated skill bodies are served without a
 * restart. New skills added after startup require a pod restart to appear in
 * tools/list — known v1 limitation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';

const SKILLS_DIR = process.env.SKILLS_DIR || '/skills';
const SERVER_NAME = process.env.SERVER_NAME || 'mcp-skills-server';

/** Parse SKILL.md — returns { frontmatter, body }. */
function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.startsWith('---')) {
    const parts = content.split(/^---$/m);
    if (parts.length >= 3) {
      const fm = {};
      for (const line of parts[1].trim().split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      return { frontmatter: fm, body: parts.slice(2).join('---').trim() };
    }
  }
  return { frontmatter: {}, body: content.trim() };
}

/** Scan SKILLS_DIR at startup — returns Map<name, {description, skillFile}>. */
function loadSkills() {
  const skills = new Map();
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`SKILLS_DIR ${SKILLS_DIR} does not exist — no skills loaded`);
    return skills;
  }
  const entries = fs.readdirSync(SKILLS_DIR).sort();
  for (const entry of entries) {
    const skillDir = path.join(SKILLS_DIR, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');
    try {
      if (fs.statSync(skillDir).isDirectory() && fs.existsSync(skillFile)) {
        const { frontmatter } = parseSkillFile(skillFile);
        const name = frontmatter.name || entry;
        const description = frontmatter.description || `Skill: ${name}`;
        skills.set(name, { description, skillFile });
        console.error(`registered skill: ${name}`);
      }
    } catch (err) {
      console.error(`skipping ${entry}: ${err.message}`);
    }
  }
  return skills;
}

const skills = loadSkills();
console.error(`startup scan complete: ${skills.size} skill(s) registered`);

const server = new Server(
  { name: SERVER_NAME, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Array.from(skills.entries()).map(([name, { description }]) => ({
    name,
    description,
    inputSchema: { type: 'object', properties: {}, required: [] },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  if (!skills.has(name)) {
    throw new Error(`Unknown skill: ${name}`);
  }
  // Lazy reload: re-read from disk on every call so updated content is served
  // without a pod restart.
  const { body } = parseSkillFile(skills.get(name).skillFile);
  return { content: [{ type: 'text', text: body }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
