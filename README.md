# MentorQA

MentorQA is an automated, AI-augmented code review and mentoring platform for engineering teams and students. It combines static AST analysis, architectural graph extraction (Neo4j), dynamic sandbox testing, and LLM-powered educational enrichment (Gemini) to provide deeply grounded, actionable feedback on code quality, security, architecture, and testing.

---

## Architecture Overview

- **`apps/web`**: Next.js 14 frontend dashboard for managing repositories, viewing review runs, and inspecting findings.
- **`apps/api`**: Express backend providing REST endpoints, GitHub OAuth integration, and job orchestration.
- **`apps/worker`**: BullMQ background worker handling the analysis pipeline (AST analysis, architectural graph ingestion, test generation & sandbox execution, and AI mentor enrichment).
- **`services/analysis`**: FastAPI service running Tree-sitter multi-language AST parsers (JavaScript, TypeScript, Python) and Java AST analyzer.
- **`apps/java-analyzer`**: Standalone JavaParser JAR for deep Java static analysis (`java-long-method`, `java-hardcoded-secret`).
- **`packages/db`**: Prisma ORM schema and client package targeting PostgreSQL.
- **`packages/shared-types`**: Shared TypeScript contracts used across the web app and worker.

---

## Getting Started (Fresh Clone Setup)

### 1. Prerequisites
- **Node.js**: v20+ or v24
- **pnpm**: v9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker & Docker Compose**: For PostgreSQL, Redis, and Neo4j
- **Python**: 3.12+ (for `services/analysis`)
- **Java JDK / JRE**: 17+ (for building/running `java-analyzer`)

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/Lucky-939/mentorQA.git
cd mentorQA
pnpm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` in the root and in `apps/worker/.env`:
```bash
cp .env.example .env
cp .env.example apps/worker/.env
```
Ensure your database credentials, Redis URL, and `GEMINI_API_KEY` are provided.

### 4. Backing Services (Docker)
Start PostgreSQL, Redis, and Neo4j:
```bash
docker compose up -d postgres redis neo4j
```
- **PostgreSQL**: `localhost:5433` (mapped from 5432)
- **Redis**: `localhost:6380` (mapped from 6379)
- **Neo4j**: `localhost:7687` (Bolt) and `localhost:7474` (HTTP browser)

### 5. Database Schema Setup (Fresh Clone)
MentorQA uses Prisma with PostgreSQL. All schema changes in the repository are managed declaratively using `prisma db push`.

To push the complete schema and generate the Prisma Client on a fresh database, run:
```bash
# Push schema directly to database
pnpm --filter @mentorqa/db run prisma:push

# Generate Prisma client
pnpm --filter @mentorqa/db run prisma:generate

# Build database package
pnpm --filter @mentorqa/db build
```

### 6. Build Shared Packages
```bash
pnpm --filter @mentorqa/shared-types build
```

### 7. Run the Application
In your primary terminal:
```bash
pnpm dev
```
This runs `apps/web` (http://localhost:3000), `apps/api` (http://localhost:3001), and `apps/worker` concurrently.

In a secondary terminal, start the Python analysis service:
```bash
cd services/analysis
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate
pip install -r requirements.txt
fastapi dev main.py
```

---

## Prisma Schema History & Migrations

All schema changes across MentorQA development iterations were applied using `prisma db push` rather than cumulative migration files (`prisma migrate dev`):

1. **Initial Schema (`f2f0f8e`)**: Defined initial `User`, `Repository`, and `Job` models.
2. **Review Model Addition (`23e0ceb`)**: Added `Review` model with `staticAnalysis Json?` to store raw static analysis findings.
3. **Findings Field Rename (`1745ee3`)**: Renamed `staticAnalysis` to `findings Json?` across Prisma schema, API serializers, and worker pipeline.
4. **Enrichment Stats (`76bf494`)**: Added `enrichmentStats Json?` to `Review` model to store AI mentor token usage, batch counts, latency, and status metrics.
5. **Review Metadata (`250443e`)**: Added `metadata Json?` to `Review` model to store timing breakdowns, pipeline stage durations, and run configurations.

Because no migration files exist in `packages/db/prisma/migrations/`, any fresh clone or deployment must initialize the database using `pnpm --filter @mentorqa/db run prisma:push` (or `npx prisma db push`).
