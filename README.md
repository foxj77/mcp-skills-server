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

## Kubernetes deployment

```bash
helm install skills oci://ghcr.io/foxj77/charts/mcp-skills-server \
  --namespace ai \
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

# Install with CA cert configured
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

Configure the URL `https://skills-webhook.example.com/webhook` in your GitHub/GitLab repository settings (push events only).

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

## Sync behavior

- **Init container**: clones the repository before the skills server starts
- **Sidecar**: runs `git pull` every `git.syncIntervalSeconds` (default: 900s / 15 min)
- **Webhook** (optional): triggers an immediate `git pull` on push events
- **Lazy reload**: updated skill content is read from disk on the next tool call — no restart needed for content changes
- **New skills**: require a pod restart to appear in `tools/list` (v1 limitation)

## Configuration reference

See [`chart/values.yaml`](chart/values.yaml) for all options with inline documentation.

## Local development

```bash
docker build -t mcp-skills-server .

docker run -p 3000:3000 \
  -v "$PWD/tests/fixtures:/skills:ro" \
  -e SKILLS_DIR=/skills \
  mcp-skills-server

./tests/smoke-test.sh
```
