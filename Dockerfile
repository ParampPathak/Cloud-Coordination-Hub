FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/frontend ./dist/frontend
COPY --from=build --chown=node:node /app/dist/backend/backend ./dist/backend/backend
COPY --from=build --chown=node:node /app/dist/backend/shared ./dist/backend/shared
COPY --from=build --chown=node:node /app/dist/backend/scripts/create-user.js /app/dist/backend/scripts/seed.js ./dist/backend/scripts/
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/backend/backend/src/server.js"]
