# Changelog

All notable changes to this project will be documented in this file.
Versions are managed automatically by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/).

<!-- next-release-here -->

## [1.1.0](https://github.com/foxj77/mcp-skills-server/compare/v1.0.1...v1.1.0) (2026-05-19)


### Features

* **chart:** add git.skillsSubdir for monorepo support ([12a5489](https://github.com/foxj77/mcp-skills-server/commit/12a5489624a785e823efb7b275d0cd0d313ed727))

## [1.0.1](https://github.com/foxj77/mcp-skills-server/compare/v1.0.0...v1.0.1) (2026-05-17)


### Bug Fixes

* polling bug, deep health probes, automated releases, single-replica docs ([2d7e441](https://github.com/foxj77/mcp-skills-server/commit/2d7e44105f321857aeda2186c03b5a215d886d69))

## [1.0.0](https://github.com/foxj77/mcp-skills-server/compare/v0.1.0...v1.0.0) (2026-05-17)


### ⚠ BREAKING CHANGES

* server runtime is now Node.js; Python files removed

### Features

* initial release — Git-synced MCP skills server for Kubernetes ([6d55809](https://github.com/foxj77/mcp-skills-server/commit/6d558098360b8dfee0d3ca4de3946d461ee834ea))
* rewrite server from Python/FastMCP to zero-dependency Node.js ([9836135](https://github.com/foxj77/mcp-skills-server/commit/9836135c7e6ddce5d7fe72646e45816c9c32bf8f))

## 0.1.0 (initial release)

- FastMCP skills server wrapped in supergateway for MCP Streamable HTTP
- Git sync via init container (clone) + sidecar (polling + optional webhook)
- Internal CA certificate support via Kubernetes Secret mount
- PAT authentication for private GitHub and GitLab repositories
- Optional webhook receiver with GitHub HMAC-SHA256 and GitLab token auth
- Configurable webhook Ingress (disabled by default)
- kagent RemoteMCPServer integration
- Helm chart with values schema validation
