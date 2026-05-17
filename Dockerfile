FROM node:26-alpine

# git: needed by the init-container and sidecar entrypoints (same image, different CMD).
RUN apk add --no-cache git

RUN npm install -g supergateway@3.4.3

COPY server.js /app/server.js
COPY sidecar/  /app/sidecar/

EXPOSE 3000

ENV SKILLS_DIR=/skills
ENV SERVER_NAME=mcp-skills-server

# --outputTransport streamableHttp  required for MCP streamable HTTP (kagent and most frameworks)
# --stateful                        keeps one persistent stdio child process across HTTP requests
#                                   (stateless mode spawns a new process per request, causing
#                                    cold-start latency on every call and breaking MCP session
#                                    continuity between initialize and tools/call)
CMD ["supergateway", "--port", "3000", "--outputTransport", "streamableHttp", \
     "--stateful", "--stdio", "node /app/server.js"]
