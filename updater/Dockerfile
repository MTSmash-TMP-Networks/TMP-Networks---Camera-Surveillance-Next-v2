FROM node:24.18.0-bookworm-slim

# Universal updater runtime:
# - Docker CLI 20.x negotiates safely with Docker 20 and newer daemons.
# - the official Docker Compose v2 CLI plugin is bundled in the updater image.
# - docker-compose v1 remains as a fallback only on compatible old Docker hosts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl docker.io docker-compose unzip rsync bash coreutils sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Use Docker's official multi-architecture, version-pinned Compose v2 binary.
# The host may already have v5, but the updater runs in its OWN container.
COPY --from=docker/compose-bin:v2.40.3 /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
RUN docker compose version

WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 3010
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/usr/local/bin/node", "src/healthcheck.js"]
CMD ["/usr/local/bin/node", "src/server.js"]
