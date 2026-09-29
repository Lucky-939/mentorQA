# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN corepack enable

WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/

# Install with BuildKit cache mount so re-builds don't re-download
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy the rest of the source
COPY . .

# Generate Prisma Client in the shared packages/db
RUN pnpm --filter @mentorqa/db run prisma:generate
RUN pnpm --filter @mentorqa/db run build

# Build the API app
RUN pnpm --filter @mentorqa/api run build

# Deploy isolated production bundle for the API
RUN pnpm deploy --filter @mentorqa/api --prod --legacy /prod/api

# Re-generate Prisma Client in the deployed bundle
RUN cd /prod/api && npx prisma generate --schema=node_modules/@mentorqa/db/prisma/schema.prisma

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy the isolated bundle
COPY --from=builder /prod/api ./

EXPOSE 3001

# Run migrations using the schema from the shared package, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy --schema=node_modules/@mentorqa/db/prisma/schema.prisma && node dist/index.js"]
