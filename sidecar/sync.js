'use strict';
const { execFile } = require('child_process');
const { createServer } = require('http');
const crypto = require('crypto');

const SKILLS_DIR = process.env.SKILLS_DIR || '/skills';
const SYNC_INTERVAL = parseInt(process.env.GIT_SYNC_INTERVAL_SECONDS || '900', 10);
const WEBHOOK_ENABLED = process.env.WEBHOOK_ENABLED === 'true';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '9000', 10);
const WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET || '';
const GIT_SSL_CAINFO = process.env.GIT_SSL_CAINFO || '';

function gitPull() {
  const env = { ...process.env };
  if (GIT_SSL_CAINFO) env.GIT_SSL_CAINFO = GIT_SSL_CAINFO;

  execFile('git', ['-C', SKILLS_DIR, 'pull', '--ff-only'], { env }, (err, stdout, stderr) => {
    if (err) {
      process.stderr.write(`git pull failed: ${err.message}\n`);
      if (stderr) process.stderr.write(stderr);
    } else {
      const out = stdout.trim();
      process.stderr.write(`git pull: ${out || 'already up to date'}\n`);
    }
  });
}

// Polling sync
setInterval(gitPull, SYNC_INTERVAL * 1000);
process.stderr.write(`git-sync started: polling every ${SYNC_INTERVAL}s, SKILLS_DIR=${SKILLS_DIR}\n`);

if (!WEBHOOK_ENABLED) {
  process.stderr.write('webhook disabled\n');
  process.exit(0); // keep the process alive via the interval
}

// Webhook server
const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // GitHub: X-Hub-Signature-256
    const ghSig = req.headers['x-hub-signature-256'];
    if (ghSig && WEBHOOK_HMAC_SECRET) {
      const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_HMAC_SECRET).update(body).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(ghSig), Buffer.from(expected))) {
        process.stderr.write('webhook: invalid GitHub HMAC signature\n');
        res.writeHead(401);
        res.end();
        return;
      }
    }

    // GitLab: X-Gitlab-Token
    const glToken = req.headers['x-gitlab-token'];
    if (glToken && WEBHOOK_HMAC_SECRET) {
      if (glToken !== WEBHOOK_HMAC_SECRET) {
        process.stderr.write('webhook: invalid GitLab token\n');
        res.writeHead(401);
        res.end();
        return;
      }
    }

    process.stderr.write('webhook: received push event, triggering git pull\n');
    gitPull();
    res.writeHead(200);
    res.end('ok');
  });
});

server.listen(WEBHOOK_PORT, () => {
  process.stderr.write(`webhook server listening on :${WEBHOOK_PORT}\n`);
});
