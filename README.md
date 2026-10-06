# AgentOS

A multi-user operating system for persistent, personality-driven AI agents that use their own models and connect to real tools through MCP.

- Product spec: [`docs/AgentOS_PRD_v1.2.md`](docs/AgentOS_PRD_v1.2.md)
- Build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Reference screens: [`docs/AgentOS Dark-Mode AI Dashboard Collage.png`](<docs/AgentOS Dark-Mode AI Dashboard Collage.png>)

**Status:** M0 (scaffolding) done.

## Repository layout

```text
apps/web                 Next.js UI + API (App Router)
apps/worker              BullMQ background workers
packages/db              Drizzle schema, migrations, database client
packages/core            Domain services shared by web and worker (env, queues, health, ...)
packages/model-gateway   Provider adapters, Smart Router, fallback chains (M4)
packages/mcp-gateway     MCP client, discovery, tool registry (M5)
packages/policy          Permissions, approvals, budgets (M5–M6)
packages/ui              Design system components (M2)
packages/i18n            en / tr message catalogs (M2)
```

Workspace packages ship TypeScript source; Next.js transpiles them and the worker runs on `tsx`.

## Run with Docker Compose

Requires Docker.

```sh
cp .env.example .env
# set AGENTOS_MASTER_KEY: openssl rand -base64 32
docker compose up --build
```

- Web: http://localhost:3000. Health: http://localhost:3000/api/health
- Ollama, if you use it, runs on the host and is reached at `host.docker.internal:11434`.

## Run locally without Docker

Requires Node 24+, pnpm (`corepack enable`), PostgreSQL and Redis.

```sh
cp .env.example .env          # point DATABASE_URL / REDIS_URL at your local services
pnpm install
pnpm db:migrate
pnpm dev                      # web on :3000 + worker
pnpm --filter @agentos/worker queue:ping   # round-trips a job through Redis and the worker
```

All apps and scripts read the single `.env` at the repo root.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test          # unit tests (Vitest)
pnpm test:e2e      # Playwright; starts the dev server
pnpm format:check
```

CI (`.github/workflows/ci.yml`) runs all of these, plus E2E against Postgres (pgvector) and Redis service containers.

## Rules worth knowing

- Only `packages/db` may import `postgres` / `drizzle-orm/postgres-js` (enforced by ESLint). Tenant scoping lands in M1.
- Secrets never go into prompts, logs or browser code (PRD §21).
