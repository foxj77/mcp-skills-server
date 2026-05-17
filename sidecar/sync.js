#!/usr/bin/env node
/**
 * Git sync sidecar.
 *
 * 1. Polls: runs `git pull` every GIT_SYNC_INTERVAL_SECONDS (default 900).
 * 2. Webhook (optional): receives POST /webhook from GitHub/GitLab and triggers
 *    an immediate git pull. Supports GitHub HMAC-SHA256 and GitLab token auth.
 *
 * The SKILLS_DIR is already cloned by the init container. Credentials embedded
 * in the remote URL by the init container are preserved in .git/config, so git
 * pull requires no additional auth configuration here.
 */
import { execFile } from 'child_process';
import { createServer } from 'http';
import crypto from 'crypto';

const SKILLS_DIR = process.env.SKILLS_DIR || '/skills';
const SYNC_INTERVAL = parseInt(process.env.GIT_SYNC_INTERVAL_SECONDS || '900', 10);
const WEBHOOK_ENABLED = (process.env.WEBHOOK_ENABLED || 'false').toLowerCase() === 'true';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '9000', 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_HMAC_SECRET || '';
const GIT_SSL_CAINFO = process.env.GIT_SSL_CAINFO || '';

let pulling = false;

function gitPull() {
  if (pulling) return;
  pulling = true;
  const env = { ...process.env };
  if (GIT_SSL_CAINFO) env.GIT_SSL_CAINFO = GIT_SSL_CAINFO;

  execFile('git', ['-C', SKILLS_DIR, 'pull', '--ff-only'], { env }, (err, stdout, stderr) => {
    pulling = false;
    if (err) {
      console.error(`git pull failed: ${stderr.trim()}`);
    } else {
      console.log(`git pull: ${stdout.trim() || 'already up to date'}`);
    }
  });
}

// Polling loop
setInterval(gitPull, SYNC_INTERVAL * 1000);
console.log(`polling sync started (interval=${SYNC_INTERVAL}s)`);

if (WEBHOOK_ENABLED) {
  const httpServer = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404).end();
      return;
    }

    let body = Buffer.alloc(0);
    req.on('data', chunk => { body = Buffer.concat([body, chunk]); });
    req.on('end', () => {
      if (WEBHOOK_SECRET) {
        // GitHub: X-Hub-Signature-256: sha256=<hex>
        const ghSig = req.headers['x-hub-signature-256'] || '';
        if (ghSig.startsWith('sha256=')) {
          const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
          if (!crypto.timingSafeEqual(Buffer.from(ghSig), Buffer.from(expected))) {
            res.writeHead(401).end();
            return;
          }
        } else {
          // GitLab: X-Gitlab-Token: <plain token>
          const glToken = req.headers['x-gitlab-token'] || '';
          const expectedBuf = Buffer.from(WEBHOOK_SECRET);
          const actualBuf = Buffer.from(glToken);
          if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
            res.writeHead(401).end();
            return;
          }
        }
      }

      res.writeHead(200).end();
      console.log('webhook received — triggering git pull');
      gitPull();
    });
  });

  httpServer.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`webhook receiver listening on :${WEBHOOK_PORT}/webhook`);
  });
} else {
  console.log('webhook disabled — polling only');
}
