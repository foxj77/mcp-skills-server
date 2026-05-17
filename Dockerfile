FROM node:26-alpine

# git: needed by the init-container and sidecar entrypoints (same image, different CMD).
RUN apk add --no-cache git

RUN npm install -g supergateway@3.4.3

COPY server.js       /app/server.js
COPY healthcheck.js  /app/healthcheck.js
COPY sidecar/        /app/sidecar/

EXPOSE 3000

ENV SKILLS_DIR=/skills
ENV SERVER_NAME=mcp-skills-server

# --outputTransport streamableHttp  required for MCP streamable HTTP (kagent and most frameworks)
# --stateful                        keeps one persistent stdio child process across HTTP requests
#                                   (stateless mode spawns a new process per request, causing
#                                    cold-start latency on every call and breaking MCP session
#                                    continuity between initialize and tools/call)
# "node /app/server.js" is ONE string — supergateway's --stdio splits it internally.
# Passing node and /app/server.js as two separate CMD elements causes supergateway to
# only see "node" and launch the Node REPL instead of the server.
CMD ["supergateway", "--port", "3000", "--outputTransport", "streamableHttp", \
     "--stateful", "--stdio", "node /app/server.js"]
