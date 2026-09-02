FROM node:24.18.0-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY scripts/patch-onvif-ptz-service-evidence.cjs ./scripts/patch-onvif-ptz-service-evidence.cjs
RUN npm ci --omit=dev --no-audit --no-fund || (rm -rf node_modules && npm cache clean --force && npm ci --omit=dev --no-audit --no-fund)

FROM node:24.18.0-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl dumb-init unzip nmap gosu smbclient openssh-client sshpass && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Docker preserves source file modes from the build context. Normalize /app so
# arbitrary configured PUID:PGID users can read the application on NAS/DSM hosts.
RUN useradd --system --uid 10001 --create-home camera \
    && mkdir -p /data/live /data/recordings /data/updates /data/backups /data/snapshots \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chmod -R a+rX /app \
    && chown -R camera:camera /app /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 CMD curl -fsS http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
