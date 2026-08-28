FROM node:20-alpine AS base

WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/contracts/package*.json ./packages/contracts/
RUN npm install

FROM base AS dev
COPY . .
WORKDIR /workspace/apps/web
EXPOSE 8081
CMD ["npm", "run", "dev"]

FROM base AS build
COPY . .
# NEXT_PUBLIC_* vars must be available at build time to be baked into the JS bundle.
# Pass via docker-compose.droplet.yml build.args → --env-file .env.droplet
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm install
RUN npm run build -w packages/contracts && npm run build -w apps/web

FROM node:20-alpine AS prod
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/web/package.json ./apps/web/package.json
COPY --from=build /workspace/apps/web/.next ./apps/web/.next
COPY --from=build /workspace/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
EXPOSE 8081
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "-p", "8081"]
