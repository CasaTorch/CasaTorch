# CasaTorch as a Home Assistant add-on. Home Assistant builds this on your machine the first time you
# install (a few minutes on a Raspberry Pi). Settings, floors and photos live in the add-on's /data,
# which Home Assistant includes in its backups.
ARG BUILD_FROM=node:22-bookworm-slim
FROM ${BUILD_FROM}
# A release tag (build.yaml). The source is checked against the release's checksums, signed with CasaTorch's offline
# release key, before it is built: a changed tag or download fails the build. Releases from before 0.8.0 have no
# signed file list - the build says so and carries on unless CASATORCH_REQUIRE_SIGNED=1. A branch name (for
# development) builds without the check.
ARG CASATORCH_REF=v0.9.0
ARG CASATORCH_REQUIRE_SIGNED=0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends traceroute iputils-tracepath mtr-tiny && rm -rf /var/lib/apt/lists/*
COPY verify-release.js /tmp/verify-release.js
ADD https://github.com/casatorch/casatorch/archive/${CASATORCH_REF}.tar.gz /tmp/casatorch.tgz
RUN set -e; mkdir -p /tmp/rel /tmp/src && tar xzf /tmp/casatorch.tgz -C /tmp/src \
 && rc=3; if echo "$CASATORCH_REF" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then \
      node -e "(async()=>{for(const f of ['SHA256SUMS','SHA256SUMS.sig','casatorch-source-files.sha256']){const r=await fetch('https://github.com/casatorch/casatorch/releases/download/'+process.argv[1]+'/'+f).catch(()=>null);if(r&&r.ok)require('fs').writeFileSync('/tmp/rel/'+f,Buffer.from(await r.arrayBuffer()))}})()" "$CASATORCH_REF"; \
      rc=0; node /tmp/verify-release.js /tmp/src/casatorch-* /tmp/rel/SHA256SUMS /tmp/rel/SHA256SUMS.sig /tmp/rel/casatorch-source-files.sha256 || rc=$?; fi \
 && if [ "$rc" = 1 ]; then echo "CasaTorch $CASATORCH_REF doesn't match its signed release - not building" >&2; exit 1; fi \
 && if [ "$rc" != 0 ]; then if [ "$CASATORCH_REQUIRE_SIGNED" = 1 ]; then echo "no signed file list for $CASATORCH_REF" >&2; exit 1; fi; echo "note: $CASATORCH_REF has no signed file list to check"; fi \
 && mv /tmp/src/casatorch-* /tmp/casatorch-src && rm -rf /tmp/rel /tmp/src /tmp/verify-release.js \
 && cp -r /tmp/casatorch-src/app/. /app/ && cp -r /tmp/casatorch-src/demo /demo \
 && rm -rf /tmp/casatorch-src /tmp/casatorch.tgz \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
 && node build.mjs
ENV CASATORCH_DATA_DIR=/data PORT=8090 NODE_ENV=production
# Starts as root only to give /data to the "node" user, then runs CasaTorch as that user (never root) -
# the same entrypoint as the Docker image (app/docker-entrypoint.sh).
RUN install -m 755 /app/docker-entrypoint.sh /usr/local/bin/casatorch-entrypoint
ENTRYPOINT ["casatorch-entrypoint"]
CMD ["node", "server.js"]
