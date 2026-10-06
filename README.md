# AgentOS

A multi-user operating system for persistent, personality-driven AI agents that use their own models and connect to real tools through MCP.

- Product spec: [`docs/AgentOS_PRD_v1.2.md`](docs/AgentOS_PRD_v1.2.md)
- Build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Reference screens: [`docs/AgentOS Dark-Mode AI Dashboard Collage.png`](<docs/AgentOS Dark-Mode AI Dashboard Collage.png>)

**Status:** M3 (agents, personality engine, Create Agent wizard) done. Next: M4 model gateway.

## Repository layout

```text
apps/web                 Next.js UI + API (App Router)
apps/worker              BullMQ background workers
packages/db              Drizzle schema, migrations, database client
packages/core            Domain services shared by web and worker (env, queues, health, ...)
packages/personality     Traits, presets, trait → directive compiler (pure; also runs in the browser)
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
cp .env.example .env          # point DATABASE_URL / REDIS_URL at your local services,
                              # set AGENTOS_MASTER_KEY (openssl rand -base64 32)
createdb agentos_test         # integration tests use their own database (TEST_DATABASE_URL)
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

- **Data access goes through `packages/db` repositories.** Only `packages/db` may import `postgres` or `drizzle-orm` (enforced by ESLint). Tenant-owned queries take a `TenantContext` and use `tenantScope()`.
- **A `TenantContext` comes only from `authenticate()`** (session cookie → user + workspace membership), never from request input. A resource from another workspace is answered with 404, exactly like a missing one.
- **Secrets** are AES-256-GCM envelope-encrypted with `AGENTOS_MASTER_KEY` and bound to their workspace. Store the returned id, call `secrets.reveal()` only where the value is used, and never log it. The logger and the audit log redact credential-shaped values.
- **Audit** important actions with `recordAudit()` (PRD §22).
- **Sessions:** the httpOnly cookie holds a random token and the database stores only its SHA-256 hash. Sessions last 30 days, renew on use and are checked against user status and membership on every request. The worker removes expired sessions every hour.
- **UI text lives in `packages/i18n/src/messages/{en,tr}.json`**, never hard-coded in components. English defines the keys; a test fails if Turkish is missing a key or a placeholder. Use `_` rather than `.` inside a key name: next-intl reads `.` as nesting. Server code returns error _codes_ (`invalid_email`, `EMAIL_TAKEN`), and the UI translates them.
- **Locale:** a signed-in user's profile locale wins, then the `agentos_locale` cookie (the switcher on the auth pages), then `Accept-Language`, then English.
- **Design system:** `packages/ui` holds shadcn-style components (Radix primitives + Tailwind + cva) and the tokens in `theme.css` (PRD §35). Use the tokens (`bg-surface`, `text-text-muted`, `text-primary` …) rather than raw colors. Chart series colors are `--color-series-1/2`, checked for color-blind separation on the dark surface.
- **Personality is compiled, never free text.** `compilePersonality()` turns 0–100 trait scores into pre-written directive sentences plus runtime parameters. The same function powers the wizard preview and (M6) the runtime prompt, so the preview is exactly what the model gets. Adding a directive means adding its model text in `packages/personality` _and_ its UI text in both catalogs (a test enforces it); bump `COMPILER_VERSION` when output changes.
- **Agent rules live in `packages/core/src/agents.ts`:** lifecycle transitions (`allowedActions`), readiness (role + job before leaving Draft), hierarchy (an agent reports only to a strictly higher-ranked type, which also rules out cycles), and auditing of every change, including per-trait before/after values.
- **Don't export non-component values from `'use client'` files** if server code needs them; Next turns them into client references. Put shared constants in a plain module (see `components/agents/filters.ts`).
- **Changing the schema:** edit `packages/db/src/schema`, run `pnpm db:generate`, then rename the new migration to something descriptive and update `migrations/meta/_journal.json` to match.
