'use strict';
// MCP health check — sends a real initialize request and exits 0 only on a
// valid JSON-RPC result. Used by Kubernetes liveness and readiness probes so
// that a failure in the Node.js child process (not just the TCP socket) is
// detected. Supergateway keeps the TCP port open even when the child is
// unresponsive, so a tcpSocket probe gives false-green results.
const http = require('http');

const body = JSON.stringify({
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'healthcheck', version: '1.0' },
  },
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 3000,
    path: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 5000,
  },
  (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      // The response is SSE — parse the first data: line and exit immediately.
      const line = buf.split('\n').find((l) => l.startsWith('data:'));
      if (!line) return;
      try {
        const parsed = JSON.parse(line.slice(5));
        if (parsed.result) { req.destroy(); process.exit(0); }
      } catch { /* fall through */ }
      req.destroy();
      process.exit(1);
    });
  }
);

req.on('timeout', () => { req.destroy(); process.exit(1); });
req.on('error', () => process.exit(1));
req.write(body);
req.end();
