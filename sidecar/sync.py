#!/usr/bin/env python3
"""Git sync sidecar.

Runs inside the pod alongside the skills server. Responsibilities:
  1. Poll: run `git pull` every GIT_SYNC_INTERVAL_SECONDS (default 900).
  2. Webhook (optional): receive POST /webhook from GitHub/GitLab and trigger
     an immediate git pull. Supports GitHub HMAC-SHA256 and GitLab token auth.

The SKILLS_DIR is the already-cloned repo directory (populated by the init
container). Credentials embedded in the remote URL by the init container are
preserved in .git/config, so git pull requires no additional auth here.
"""
import hashlib
import hmac
import http.server
import os
import subprocess
import sys
import threading
import time

SKILLS_DIR = os.environ.get("SKILLS_DIR", "/skills")
SYNC_INTERVAL = int(os.environ.get("GIT_SYNC_INTERVAL_SECONDS", "900"))
WEBHOOK_ENABLED = os.environ.get("WEBHOOK_ENABLED", "false").lower() == "true"
WEBHOOK_PORT = int(os.environ.get("WEBHOOK_PORT", "9000"))
# GitHub: HMAC-SHA256 secret. GitLab: plain token for X-Gitlab-Token comparison.
WEBHOOK_SECRET = os.environ.get("WEBHOOK_HMAC_SECRET", "")
# CA cert path for git pull (must match what was set during clone).
GIT_SSL_CAINFO = os.environ.get("GIT_SSL_CAINFO", "")

_pull_lock = threading.Lock()


def git_pull() -> None:
    env = os.environ.copy()
    if GIT_SSL_CAINFO:
        env["GIT_SSL_CAINFO"] = GIT_SSL_CAINFO

    with _pull_lock:
        result = subprocess.run(
            ["git", "-C", SKILLS_DIR, "pull", "--ff-only"],
            capture_output=True,
            text=True,
            env=env,
        )
    if result.returncode == 0:
        msg = result.stdout.strip() or "already up to date"
        print(f"git pull: {msg}", flush=True)
    else:
        print(f"git pull failed (rc={result.returncode}): {result.stderr.strip()}", file=sys.stderr, flush=True)


def _polling_loop() -> None:
    while True:
        time.sleep(SYNC_INTERVAL)
        print(f"polling sync triggered (interval={SYNC_INTERVAL}s)", flush=True)
        git_pull()


class _WebhookHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/webhook":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if WEBHOOK_SECRET:
            # GitHub: X-Hub-Signature-256: sha256=<hex>
            gh_sig = self.headers.get("X-Hub-Signature-256", "")
            if gh_sig.startswith("sha256="):
                expected = "sha256=" + hmac.new(
                    WEBHOOK_SECRET.encode(), body, hashlib.sha256
                ).hexdigest()
                if not hmac.compare_digest(gh_sig, expected):
                    self.send_response(401)
                    self.end_headers()
                    return
            else:
                # GitLab: X-Gitlab-Token: <plain token>
                gl_token = self.headers.get("X-Gitlab-Token", "")
                if not hmac.compare_digest(gl_token, WEBHOOK_SECRET):
                    self.send_response(401)
                    self.end_headers()
                    return

        self.send_response(200)
        self.end_headers()
        print("webhook received — triggering git pull", flush=True)
        threading.Thread(target=git_pull, daemon=True).start()

    def log_message(self, fmt, *args) -> None:  # suppress default HTTP logging
        pass


def _webhook_server() -> None:
    server = http.server.HTTPServer(("0.0.0.0", WEBHOOK_PORT), _WebhookHandler)
    print(f"webhook receiver listening on :{WEBHOOK_PORT}/webhook", flush=True)
    server.serve_forever()


# Start polling thread
threading.Thread(target=_polling_loop, daemon=True).start()
print(f"polling sync started (interval={SYNC_INTERVAL}s)", flush=True)

if WEBHOOK_ENABLED:
    _webhook_server()  # blocks in main thread
else:
    print("webhook disabled — polling only", flush=True)
    while True:
        time.sleep(3600)
