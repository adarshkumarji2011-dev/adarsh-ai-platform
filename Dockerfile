# ADARSH AI — single-stage production image (Vite build + Express API in one process)
FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development

# Keep the OS layer patched for the final image (same stage is used for runtime).
RUN apk upgrade --no-cache

# Build toolchain for better-sqlite3 (native addon)
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Drop build-only packages, then prune dev dependencies for a small runtime image.
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# SQLite database + uploads live here; mount a disk in production.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app

USER node

CMD ["node", "server/index.js"]
