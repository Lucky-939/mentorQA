# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install all dependencies (dev included) using frozen lockfile
RUN pnpm install --frozen-lockfile

# Generate Prisma Client in the shared packages/db
RUN pnpm --filter @mentorqa/db run prisma:generate
RUN pnpm --filter @mentorqa/db run build

# Build the API app
RUN pnpm --filter @mentorqa/api run build

# Deploy isolated production bundle for the API
RUN pnpm deploy --filter @mentorqa/api --prod --legacy /prod/api

# Re-generate Prisma Client in the deployed bundle
# pnpm deploy copies the source of local workspace packages, but we need to generate Prisma client again
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
