FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html mcp-render.html vite.config.js ./
COPY notices ./notices
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4173 BIND_HOST=0.0.0.0 BOARD_DATA_DIR=/data
RUN mkdir /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY notices ./notices
COPY src ./src
USER node
EXPOSE 4173
CMD ["node", "src/server.js"]
