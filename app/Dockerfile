# CasaTorch container. Built from the repo root (deploy/docker-compose.yml sets the context).
# Multi-arch (amd64 + arm64): .github/workflows/release.yml builds and publishes it.
FROM node:22-bookworm-slim
WORKDIR /app
# traceroute, tracepath, mtr: the hop-by-hop path in Network > App tests (no special rights needed).
RUN apt-get update && apt-get install -y --no-install-recommends traceroute iputils-tracepath mtr-tiny && rm -rf /var/lib/apt/lists/*
COPY app/package.json app/package-lock.json ./
# --ignore-scripts: no install scripts are needed, and it keeps out the static FFmpeg build that ring-client-api would
# download (built with --enable-nonfree, so it may not be redistributed in an image). See THIRD_PARTY_NOTICES.md.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY app/build.mjs ./
COPY app/src ./src
COPY app/public ./public
COPY app/catalog ./catalog
COPY demo /demo
COPY app/docker-entrypoint.sh /usr/local/bin/casatorch-entrypoint
RUN node build.mjs && mkdir -p /data && chown node:node /data && chmod 755 /usr/local/bin/casatorch-entrypoint
ENV CASATORCH_DATA_DIR=/data PORT=8090 NODE_ENV=production CASATORCH_INSTALL=docker
# Starts as root only to fix the owner of /data, then runs CasaTorch as the "node" user (docker-entrypoint.sh).
EXPOSE 8090 8443
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["casatorch-entrypoint"]
CMD ["node", "server.js"]
