# Built from the repo root (deploy/docker-compose.yml sets the context).
FROM node:22-bookworm-slim
WORKDIR /app
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY app/build.mjs ./
COPY app/src ./src
COPY app/public ./public
COPY demo /demo
RUN node build.mjs
ENV HOUSEOS_DATA_DIR=/data
EXPOSE 8090
CMD ["node", "server.js"]
