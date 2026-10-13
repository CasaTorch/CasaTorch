# HouseOS container. Built from the repo root (deploy/docker-compose.yml sets the context).
# Multi-arch (amd64 + arm64): .github/workflows/release.yml builds and publishes it.
FROM node:22-bookworm-slim
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY app/build.mjs ./
COPY app/src ./src
COPY app/public ./public
COPY app/catalog ./catalog
COPY demo /demo
RUN node build.mjs && mkdir -p /data && chown node:node /data
ENV HOUSEOS_DATA_DIR=/data PORT=8090 NODE_ENV=production
USER node
EXPOSE 8090
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
