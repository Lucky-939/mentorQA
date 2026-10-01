# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Prevent puppeteer from trying to download Chromium (not needed in API)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN corepack enable

WORKDIR /app

# Copy full monorepo (schema.prisma must be present before pnpm install runs postinstall)
COPY . .

# Install with BuildKit cache mount — packages survive across rebuilds
# --ignore-scripts skips packages/db postinstall (prisma generate) which needs DATABASE_URL
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Run only the scripts we explicitly need after install
RUN pnpm --filter @mentorqa/db run prisma:generate

# Build shared packages
RUN pnpm --filter @mentorqa/db run build

# Build the API app
RUN pnpm --filter @mentorqa/api run build

# Deploy isolated production bundle for the API
RUN pnpm deploy --filter @mentorqa/api --prod /prod/api

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g prisma@6.19.3

# Copy the isolated bundle
COPY --from=builder /prod/api ./

EXPOSE 3001

# Run migrations, then start the server
CMD ["sh", "-c", "prisma migrate deploy --schema=node_modules/@mentorqa/db/prisma/schema.prisma && node dist/index.js"]
