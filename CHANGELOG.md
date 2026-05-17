# Changelog

All notable changes to this project will be documented in this file.
Versions are managed automatically by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/).

<!-- next-release-here -->

## 0.1.0 (initial release)

- FastMCP skills server wrapped in supergateway for MCP Streamable HTTP
- Git sync via init container (clone) + sidecar (polling + optional webhook)
- Internal CA certificate support via Kubernetes Secret mount
- PAT authentication for private GitHub and GitLab repositories
- Optional webhook receiver with GitHub HMAC-SHA256 and GitLab token auth
- Configurable webhook Ingress (disabled by default)
- kagent RemoteMCPServer integration
- Helm chart with values schema validation
