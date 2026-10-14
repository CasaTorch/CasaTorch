# CasaTorch as a Home Assistant add-on. Home Assistant builds this on your machine the first time you
# install (a few minutes on a Raspberry Pi). Settings, floors and photos live in the add-on's /data,
# which Home Assistant includes in its backups.
ARG BUILD_FROM=node:22-bookworm-slim
FROM ${BUILD_FROM}
ARG CASATORCH_REF=main
WORKDIR /app
ADD https://github.com/casatorch/casatorch/archive/refs/heads/${CASATORCH_REF}.tar.gz /tmp/casatorch.tgz
RUN tar xzf /tmp/casatorch.tgz -C /tmp \
 && cp -r /tmp/casatorch-*/app/. /app/ && cp -r /tmp/casatorch-*/demo /demo \
 && rm -rf /tmp/casatorch-* /tmp/casatorch.tgz \
 && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && node build.mjs
ENV CASATORCH_DATA_DIR=/data PORT=8090 NODE_ENV=production
CMD ["node", "server.js"]
