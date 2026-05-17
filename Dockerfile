FROM node:26-alpine

# git: needed by the init-container and sidecar entrypoints (same image, different CMD).
# python3 + py3-pip: FastMCP skills server runtime.
RUN apk add --no-cache git python3 py3-pip

RUN npm install -g supergateway@3.4.3

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt --break-system-packages

COPY server.py /app/server.py
COPY sidecar/  /app/sidecar/

EXPOSE 3000

ENV SKILLS_DIR=/skills
ENV SERVER_NAME=mcp-skills-server

# --outputTransport streamableHttp  required for MCP streamable HTTP (kagent and most frameworks)
# --stateful                        keeps one persistent stdio child process across HTTP requests
#                                   (stateless mode spawns a new process per request, which causes
#                                    Python startup overhead on every call and breaks MCP session
#                                    continuity between initialize and tools/call)
CMD ["supergateway", "--port", "3000", "--outputTransport", "streamableHttp", \
     "--stateful", "--stdio", \
     "python3", "/app/server.py"]
