# CasaTorch container. Built from the repo root (deploy/docker-compose.yml sets the context).
# Multi-arch (amd64 + arm64): .github/workflows/release.yml builds, signs and publishes it.
# Pinned to an exact Node.js 22 patch release on Debian 13 (trixie), by tag and digest: move both with each Node.js
# security release, together with ha-addon/ and deploy/packaging/fetch-node.sh (Dependabot proposes the bump).
#
# Locked down: runs as the unprivileged "node" user (uid 1000), with a read-only root file system (everything it
# writes is in /data; /tmp can be a tmpfs), no setuid/setgid programs, and no npm, npx, corepack or yarn in the
# final image. See deploy/docker-compose.yml for the matching run options (read_only, cap_drop, no-new-privileges).

# ---- build: install the packages and join the source (nothing from this stage runs in the final image) ----
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
# --ignore-scripts: no install scripts are needed, and it keeps out the static FFmpeg build that ring-client-api would
# download (built with --enable-nonfree, so it may not be redistributed in an image). See THIRD_PARTY_NOTICES.md.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY app/build.mjs ./
COPY app/src ./src
COPY app/public ./public
COPY app/catalog ./catalog
RUN node build.mjs

# ---- the image people run ----
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6
# traceroute, tracepath: the hop-by-hop path in Network > App tests (no special rights needed). mtr is left out: it
# needs raw sockets, which this container never has.
# Then: no package manager for JavaScript in the running image (CasaTorch never installs anything at run time), and
# no setuid/setgid programs (su, mount, passwd...), so nothing in the container can gain rights it doesn't start with.
RUN apt-get update && apt-get install -y --no-install-recommends traceroute iputils-tracepath \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/apt /var/log/dpkg.log \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod u-s,g-s {} + \
 && mkdir -p /data && chown node:node /data && chmod 700 /data
WORKDIR /app
COPY --from=build /app /app
COPY demo /demo
COPY --chmod=755 app/docker-entrypoint.sh /usr/local/bin/casatorch-entrypoint
ENV CASATORCH_DATA_DIR=/data PORT=8090 NODE_ENV=production CASATORCH_INSTALL=docker HOME=/data
# The unprivileged user. Started as root instead (`user: "0"`, for a NAS folder that belongs to root), the entrypoint
# only gives /data to this user and then runs CasaTorch as it, never as root.
USER node:node
EXPOSE 8090 8443
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["casatorch-entrypoint"]
CMD ["node", "server.js"]
