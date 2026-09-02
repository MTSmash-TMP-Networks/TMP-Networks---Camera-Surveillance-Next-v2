FROM node:24.18.0-bookworm-slim

# Universal updater runtime:
# - Docker CLI 20.x negotiates safely with Docker 20 and newer daemons.
# - docker-compose v1 remains available for DSM 6.x.
# - the updater code also supports the Compose v2 plugin when present.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl docker.io docker-compose unzip rsync bash coreutils sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 3010
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/usr/local/bin/node", "src/healthcheck.js"]
CMD ["/usr/local/bin/node", "src/server.js"]
