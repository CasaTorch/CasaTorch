# HouseOS as a Home Assistant add-on. Home Assistant builds this on your machine the first time you
# install (a few minutes on a Raspberry Pi). Settings, floors and photos live in the add-on's /data,
# which Home Assistant includes in its backups.
ARG BUILD_FROM=node:22-bookworm-slim
FROM ${BUILD_FROM}
ARG HOUSEOS_REF=main
WORKDIR /app
ADD https://github.com/gethouseos/HouseOS/archive/refs/heads/${HOUSEOS_REF}.tar.gz /tmp/houseos.tgz
RUN tar xzf /tmp/houseos.tgz -C /tmp \
 && cp -r /tmp/HouseOS-*/app/. /app/ && cp -r /tmp/HouseOS-*/demo /demo \
 && rm -rf /tmp/HouseOS-* /tmp/houseos.tgz \
 && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && node build.mjs
ENV HOUSEOS_DATA_DIR=/data PORT=8090 NODE_ENV=production
CMD ["node", "server.js"]
