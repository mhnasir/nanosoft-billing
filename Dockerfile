# syntax=docker/dockerfile:1.7
# One small image: the built React app + the Express API. Build context is the repo root.
#   docker build -t nanosoft-billing .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY client client
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY server server
COPY scripts scripts
COPY db db
COPY --from=build /app/dist dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# db-init is idempotent (CREATE ... IF NOT EXISTS), so tables are always present before the server starts.
CMD ["sh", "-c", "node scripts/db-init.js && exec node server/index.js"]
