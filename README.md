# mcp-skills-server

A Kubernetes-native MCP server that exposes skills from a Git repository as MCP tools over Streamable HTTP. Skills follow the standard `SKILL.md` convention used by Claude Code and compatible AI terminals.

## How it works

The server clones a Git repository containing skills (one directory per skill, each with a `SKILL.md`), exposes each skill as an MCP tool, and keeps the repository in sync via polling and optional webhook triggers.

```
your-skills-repo/
├── summarize/
│   └── SKILL.md   # name: summarize, description: ..., body: prompt
├── review-pr/
│   └── SKILL.md
└── ...
```

Each `SKILL.md` becomes an MCP tool. The `description` field is used for tool discovery; the body is returned when the tool is called.

### Pod architecture

Each pod runs three containers sharing a single `emptyDir` volume at `/skills`:

```
┌─────────────────────────────────────────────────────────────┐
│ Pod                                                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ init:        │  │ sidecar:     │  │ main:             │ │
│  │ git-clone    │  │ git-sync     │  │ mcp-skills-server │ │
│  │              │  │              │  │                   │ │
│  │ git clone →  │  │ git pull     │  │ Node.js + super-  │ │
│  │ /skills      │  │ every 15 min │  │ gateway :3000/mcp │ │
│  │              │  │ + webhook    │  │                   │ │
│  └──────────────┘  └──────────────┘  └───────────────────┘ │
│                           │                   │             │
│                    ┌──────┴───────────────────┘             │
│                    │  emptyDir: /skills                     │
│                    └────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

> **Single replica only.** This Deployment is hardcoded to 1 replica. Multiple replicas each get their own independent `emptyDir`, so they could serve different skill versions mid-sync. `kubectl scale` has no lasting effect — it is overwritten on the next Helm reconciliation. For HA, run one Helm release per availability zone, each pointing at the same upstream repo.

## Kubernetes deployment

```bash
helm install skills oci://ghcr.io/foxj77/charts/mcp-skills-server \
  --namespace ai \
  --create-namespace \
  --set git.repoUrl=https://github.com/my-org/skills \
  --set git.patSecret.name=skills-git-pat \
  --set server.name=my-org-skills
```

### Required: create the PAT secret (SOPS workflow)

```bash
# Write plaintext to /tmp
cat > /tmp/skills-git-pat.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: skills-git-pat
  namespace: ai
stringData:
  token: "ghp_your_token_here"
EOF

# Encrypt and save to repo
sops --encrypt /tmp/skills-git-pat.yaml > secrets/skills-git-pat.enc.yaml

# Delete plaintext
rm /tmp/skills-git-pat.yaml
```

### Self-hosted GitLab with internal CA

```bash
# Create the CA cert secret
cat > /tmp/internal-ca.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: internal-ca
  namespace: ai
stringData:
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
EOF
sops --encrypt /tmp/internal-ca.yaml > secrets/internal-ca.enc.yaml
rm /tmp/internal-ca.yaml

helm install skills oci://ghcr.io/foxj77/charts/mcp-skills-server \
  --namespace ai \
  --set git.repoUrl=https://gitlab.internal/platform/skills \
  --set git.patSecret.name=skills-git-pat \
  --set git.caSecret.name=internal-ca \
  --set server.name=platform-skills
```

### Enable webhook for immediate sync

```bash
helm upgrade skills oci://ghcr.io/foxj77/charts/mcp-skills-server \
  --reuse-values \
  --set webhook.enabled=true \
  --set webhook.hmacSecret.name=skills-webhook-secret \
  --set webhook.ingress.enabled=true \
  --set webhook.ingress.host=skills-webhook.example.com
```

Configure `https://skills-webhook.example.com/webhook` in your GitHub/GitLab repository settings (push events only). Without a webhook, skills are synced every 15 minutes by default.

### kagent integration

```bash
helm upgrade skills oci://ghcr.io/foxj77/charts/mcp-skills-server \
  --reuse-values \
  --set kagent.enabled=true \
  --set kagent.serverName=platform-skills
```

Then reference in agent definitions:

```yaml
- type: McpServer
  mcpServer:
    apiGroup: kagent.dev
    kind: RemoteMCPServer
    name: platform-skills
```

## Skill format

```markdown
---
name: my-skill
description: One-line description for tool discovery.
---

Prompt body returned when the skill is invoked.
```

- `name` becomes the MCP tool name (must be unique within the repo)
- `description` is shown in MCP client tool listings and used for discovery
- The body is returned verbatim on every tool call

## Sync behaviour

| Event | What happens |
|---|---|
| Pod start | Init container clones the repo; skills server scans `SKILLS_DIR` and registers all skills |
| `git pull` (every 15 min) | Updated skill **content** is served on the next call — no restart needed |
| New skill directory added | Requires a pod restart to appear in `tools/list` (v1 limitation) |
| Webhook push event | Triggers an immediate `git pull` in addition to the polling schedule |

## Health checks

Liveness and readiness probes run `node /app/healthcheck.js`, which sends a real MCP `initialize` request and checks for a valid JSON-RPC result in the SSE response. This is more reliable than a TCP socket check — supergateway keeps the port open even when the child process is unresponsive, so a TCP probe gives false-green results.

## Configuration reference

See [`chart/values.yaml`](chart/values.yaml) for all options with inline documentation. Key values:

| Value | Default | Notes |
|---|---|---|
| `git.repoUrl` | `""` | Required. Full HTTPS URL of the skills repo. |
| `git.branch` | `main` | Branch to track. |
| `git.syncIntervalSeconds` | `900` | Polling interval in seconds. |
| `git.patSecret.name` | `""` | Secret name for the PAT. Leave empty for public repos. |
| `git.caSecret.name` | `""` | Secret name for a custom CA cert (self-hosted GitLab). |
| `server.name` | `mcp-skills-server` | Name the server advertises to MCP clients. |
| `webhook.enabled` | `false` | Enable the webhook receiver for immediate sync. |
| `kagent.enabled` | `false` | Create a `RemoteMCPServer` in the kagent namespace. |
| `nodeHeapSizeMb` | `128` | V8 heap cap for supergateway. Must be ≤ `resources.limits.memory / 2`. |

## Local development

```bash
docker build -t mcp-skills-server .

docker run -d --name mcp-skills \
  -p 3000:3000 \
  -v "$PWD/tests/fixtures:/skills:ro" \
  -e SKILLS_DIR=/skills \
  -e SERVER_NAME=my-skills \
  -e NODE_OPTIONS=--max-old-space-size=128 \
  mcp-skills-server

./tests/smoke-test.sh
```

List available skills from a running instance:

```bash
SESSION=$(curl -sf --max-time 10 -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1.0"}}}' \
  -D - | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\r\n') && \
curl -sf --max-time 10 -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep '^data:' | head -1 | cut -c7- \
  | python3 -c "import json,sys; [print(f'{t[\"name\"]}\n  {t[\"description\"]}') for t in json.load(sys.stdin)['result']['tools']]"
```

## Release process

Releases are fully automated via [release-please](https://github.com/googleapis/release-please):

1. Merge conventional commits to `main`
2. release-please opens a release PR bumping `version.txt` and `CHANGELOG.md`
3. Merge the release PR → GitHub Release is created and `publish.yaml` is triggered automatically
4. `publish.yaml` builds the multi-arch image and Helm chart and pushes both to GHCR

Images: `ghcr.io/foxj77/mcp-skills-server`  
Helm chart: `oci://ghcr.io/foxj77/charts/mcp-skills-server`
