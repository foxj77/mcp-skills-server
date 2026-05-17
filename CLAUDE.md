# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Kubernetes-native MCP server that exposes skills from a Git repository as MCP tools over Streamable HTTP. Skills follow the standard `SKILL.md` convention (YAML frontmatter with `name` and `description`, followed by the prompt body). The server is a zero-dependency Node.js JSON-RPC implementation wrapped by supergateway to serve Streamable HTTP.

### Pod architecture

Each pod runs three containers sharing a single `emptyDir` volume mounted at `/skills`:

```
┌─────────────────────────────────────────────────────────────┐
│ Pod                                                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ init: git-   │  │ sidecar:     │  │ main:             │ │
│  │ clone        │  │ git-sync     │  │ mcp-skills-server │ │
│  │              │  │              │  │                   │ │
│  │ git clone →  │  │ git pull     │  │ Node.js + super-  │ │
│  │ /skills      │  │ every 15min  │  │ gateway :3000/mcp │ │
│  │              │  │ + webhook    │  │                   │ │
│  └──────────────┘  └──────────────┘  └───────────────────┘ │
│                           │                   │             │
│                    ┌──────┴───────────────────┘             │
│                    │  emptyDir: /skills                     │
│                    └────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### Repository layout

```
server.js              # Zero-dependency Node.js MCP skills server (stdio, CommonJS)
healthcheck.js         # Kubernetes probe script — sends real MCP initialize, exits 0 on valid result
sidecar/sync.js        # Git sync sidecar (polling + webhook receiver, CommonJS)
Dockerfile             # Single image used by all three containers
package.json           # npm deps for Dependabot tracking (supergateway only)
chart/
├── Chart.yaml
├── values.yaml        # All tunable values with inline constraint docs
├── values.schema.json # JSON Schema — Helm validates values on install/upgrade
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml   # Webhook ingress — disabled by default
    ├── kagent-remote-mcp-server.yaml
    └── NOTES.txt
tests/
├── smoke-test.sh      # MCP protocol smoke test (curl + jq)
└── fixtures/
    └── test-skill/
        └── SKILL.md   # Test fixture skill used in CI smoke test
```

## Build / run / test

```bash
# Local build
docker build -t mcp-skills-server .

# Run against local test fixtures (no git clone needed — mount directly)
docker run -d \
  --name mcp-skills \
  -p 3000:3000 \
  -v "$PWD/tests/fixtures:/skills:ro" \
  -e SKILLS_DIR=/skills \
  -e SERVER_NAME=my-skills \
  -e NODE_OPTIONS=--max-old-space-size=128 \
  mcp-skills-server

# Smoke test
./tests/smoke-test.sh

# Against a deployed instance
MCP_URL=http://mcp-skills-server.my-namespace.svc.cluster.local:3000/mcp ./tests/smoke-test.sh
```

## Skill format

Skills must follow the standard convention:

```
skills-repo/
└── my-skill/
    └── SKILL.md
```

`SKILL.md` frontmatter:
```yaml
---
name: my-skill
description: One-line description used for MCP tool discovery.
---

Prompt body goes here. This is returned when the skill tool is called.
```

- `name` becomes the MCP tool name
- `description` is used for tool discovery by MCP clients
- The body is returned on every tool invocation (read lazily from disk)

## Skill loading behavior

Skills are scanned from `SKILLS_DIR` at server startup. Each subdirectory containing a `SKILL.md` is registered as an MCP tool. Skill content is read from disk on every tool call (lazy reload) — updated bodies are served without a restart.

**Known v1 limitation:** new skills added to the repo after startup (via git pull) require a pod restart to appear in `tools/list`. Updated content in existing skills is picked up immediately on the next call.

## Critical configuration constraints

- **`--stateful` on supergateway is required.** Stateless mode spawns a new Node.js process per HTTP request, causing cold-start latency on every call and breaking MCP session continuity between `initialize` and `tools/call`. Do not remove this flag.
- **Liveness/readiness probes use `exec: node /app/healthcheck.js`.** This sends a real MCP `initialize` request. Do not revert to `tcpSocket` — supergateway keeps the port open even when the child process is dead, giving false-green results.
- **`sidecar/sync.js` must not call `process.exit()` when webhook is disabled.** The `setInterval` for polling runs in the same process. Exiting kills it and stops all sync.
- **Releases are fully automated.** Merging a release-please PR triggers the publish workflow automatically via `gh workflow run` in the release-please workflow. No manual trigger needed.
- **`--stdio "node /app/server.js"` must be ONE string.** supergateway's `--stdio` flag takes a single string it splits internally. Passing `node` and `/app/server.js` as two separate Dockerfile CMD elements causes supergateway to only see `node` and launch the Node REPL. See the `CMD` line in Dockerfile.
- **`nodeHeapSizeMb` must be ≤ `resources.limits.memory / 2`.** The pod runs two Node.js processes (supergateway + server). If the Node heap cap exceeds half the memory limit, the pod risks OOMKill.
- **CA cert secret must be created before installing the chart.** The chart references an existing Secret by name and will not create it. Use SOPS for encryption: write plaintext to `/tmp`, encrypt with `sops --encrypt`, save as `.enc.yaml` in the repo, delete `/tmp` file.
- **PAT token embedded in `.git/config`.** The init container embeds the PAT in the git remote URL (stored in `.git/config` on the emptyDir). The sidecar inherits this for `git pull`. The PAT is not exposed in environment variables of the main skills server container.
- **`imagePullPolicy: IfNotPresent`** is the default and correct for pinned version tags. If tracking a mutable tag such as `latest` in examples, use `Always`.
- **`--outputTransport streamableHttp`** is required. SSE transport is legacy and not supported by kagent.
- **server.js and sidecar/sync.js use CommonJS (`require()`).** There is no `"type": "module"` in package.json. Do not convert to ESM — Node.js on Alpine requires explicit `.mjs` or a module-type package.json for ESM, and the image has neither.

## npm package versions

Pinned in both `Dockerfile` (`RUN npm install -g`) and `package.json` (for Dependabot). When Dependabot raises a PR bumping `supergateway` in `package.json`, the matching version in the Dockerfile must be updated in the same PR before merging.

## Commit messages — conventional commits (required)

All commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/). `release-please` reads commit history to determine the next SemVer version and generate the changelog.

| Prefix | Changelog section | Version bump |
|--------|-------------------|-------------|
| `feat:` | Features | minor |
| `fix:` | Bug Fixes | patch |
| `perf:` | Performance | patch |
| `docs:` | Documentation | patch |
| `refactor:` | Refactors | patch |
| `chore:` | (hidden) | patch |
| `feat!:` or `BREAKING CHANGE:` footer | Features | major |

## Release process

1. Merge conventional commits to `main` — release-please opens a release PR
2. Merge the release PR — GitHub Release and SemVer tag are created automatically
3. The publish workflow triggers on the release: builds multi-arch image, pushes to GHCR, packages and pushes Helm chart to OCI registry
4. Install: `helm install skills oci://ghcr.io/foxj77/charts/mcp-skills-server --set git.repoUrl=...`

Images publish to `ghcr.io/foxj77/mcp-skills-server`. Helm chart publishes to `oci://ghcr.io/foxj77/charts/mcp-skills-server`.
