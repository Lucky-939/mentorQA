# MentorQA — Local Development Guide

This project is a monorepo that relies on backing services (Postgres, Redis, Neo4j) and multiple apps (Web, API, Worker, Analysis). For local development, it is highly recommended to run **only the backing services** in Docker, and run the Node.js/Python code directly on your host machine for hot-reloading.

## 1. Start the Backing Services (Docker)

Do **not** run `docker compose up -d` without specifying the services, as it will attempt to build the production images for the API and Analysis layers (which can fail without correct `.env` files injected during the build).

Instead, run only the databases:

```bash
docker compose up -d postgres redis neo4j
```

This starts:
- **Postgres:** Port `5433`
- **Redis:** Port `6380`
- **Neo4j:** Ports `7474` (UI) and `7687` (Bolt)

## 2. Run the Node.js Monorepo (Web, API, Worker)

Make sure you are in the root directory of the project.

```bash
# 1. Install dependencies (if you haven't recently)
pnpm install

# 2. Push Prisma database schema (if you changed the schema or it's a fresh DB)
pnpm --filter @mentorqa/db db:push

# 3. Start the Next.js frontend, Express API, and BullMQ Worker in parallel
pnpm dev
```

This starts:
- **Web (Next.js):** `http://localhost:3000`
- **API (Express):** `http://localhost:3001`
- **Worker (BullMQ):** Runs in the background picking up Redis jobs.

## 3. Run the Python Analysis Service (FastAPI)

In a **separate terminal**, run the Python microservice:

```bash
# 1. Navigate to the service folder
cd services/analysis

# 2. Activate your virtual environment (Windows)
# If you don't have one: python -m venv venv
.\venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the FastAPI server in development mode
fastapi dev main.py
```

This starts:
- **Analysis (FastAPI):** `http://localhost:8000`

---

### Troubleshooting

- **"Prisma Client / Connection Refused"**: Ensure `DATABASE_URL` uses `127.0.0.1:5433` instead of `localhost:5433` if you are on Windows, as Node often defaults to IPv6 (`::1`) which Docker Desktop doesn't bind to by default.
- **Port Conflicts**: If port 3001 is taken by `wslrelay.exe` or Docker, ensure you restarted the conflicting service or changed the API port in `.env`.
