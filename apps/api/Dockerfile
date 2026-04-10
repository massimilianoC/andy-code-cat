FROM node:20-alpine AS base

# Install Chromium for Puppeteer — official guide: https://pptr.dev/guides/docker
# Using system Chromium on Alpine to avoid downloading a full bundled Chrome.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Puppeteer to use the system-installed Chromium and skip the npm bundled download.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/contracts/package*.json ./packages/contracts/
RUN npm install

FROM base AS dev
COPY . .
WORKDIR /workspace/apps/api
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM base AS build
COPY . .
RUN npm install
RUN npm run build -w packages/contracts && npm run build -w apps/api

FROM node:20-alpine AS prod
# Chromium needed for Puppeteer at runtime — https://pptr.dev/guides/docker
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
