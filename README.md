# AgentOS

A multi-user operating system for persistent, personality-driven AI agents that use their own models and connect to real tools through MCP.

- Product spec: [`docs/AgentOS_PRD_v1.2.md`](docs/AgentOS_PRD_v1.2.md)
- Build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Reference screens: [`docs/AgentOS Dark-Mode AI Dashboard Collage.png`](<docs/AgentOS Dark-Mode AI Dashboard Collage.png>)

**Status:** v0.3 complete. v0.1 (M0–M6): agents with personalities and per-agent models, MCP tools with server-side permissions, chat with tool use, approvals, budgets and full run logs. v0.2 (M7): tasks with dependencies, retries, cancel and state history; one-time and recurring schedules; run recovery. v0.3 (M8): knowledge sources (notes, files, web pages) with hybrid search, private per-user memory, and feedback that suggests rules and personality changes for you to accept. Next: v0.4 multi-agent orchestration.

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

Requires Node 24+, pnpm (`corepack enable`), PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension, and Redis.

If your Postgres has no pgvector package (Homebrew's `pgvector` only targets Postgres 17/18), build it against your server: `git clone --branch v0.8.7 https://github.com/pgvector/pgvector && cd pgvector && PG_CONFIG=$(brew --prefix postgresql@15)/bin/pg_config make install`. Then, as a superuser, run `CREATE EXTENSION vector;` in both `agentos` and `agentos_test` (the migration does it too, but needs superuser rights).

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
- **Model calls go through `invokeModel()` (`packages/model-gateway`).** It plans candidates from the agent's strategy, skips models that can't serve the request (task type, context size, per-task budget), falls back only on outages, rate limits and timeouts, and reports every decision as an event that `runAgentPrompt()` stores in `run_events`. Configuration errors (bad key, unknown model) are never hidden behind a fallback.
- **Provider SDKs:** official SDKs only (`openai`, `@anthropic-ai/sdk`, `@google/genai`); OpenAI, Ollama and OpenAI-compatible servers share one adapter. Current Claude models reject `temperature`, so sampling parameters are sent only to models the capability registry marks as accepting them. Claude Fable 5.1 / Opus 5.5 / Opus 5 / Sonnet 5.5 requests opt into Anthropic's server-side refusal fallback; any model switch it makes is recorded as `model.provider_fallback`.
- **Testing without API keys:** `pnpm --filter @agentos/model-gateway fake-provider` serves OpenAI-compatible (`/openai/v1`, also usable as an Ollama endpoint at `/openai`) and Anthropic (`/anthropic`) APIs on port 4010. Models named `*-down` return 503, `*-limited` 429. Playwright starts it automatically.
- **Every tool call goes through `executeAgentTool()` (`packages/core/src/mcp.ts`).** It evaluates `@agentos/policy` server-side on each call: tools an agent was never granted, disabled tools/servers and BLOCKED tools are refused and audited; APPROVAL_REQUIRED (or a high-risk category the agent's approval policy covers) is refused until the approval inbox lands in M6. An agent's mode can never be looser than the tool's workspace default, and connecting a server grants nothing to any agent.
- **MCP credentials** (bearer token, custom headers, OAuth client registration and tokens) live in the secret store per connection. OAuth: `startMcpAuthorization()` returns the server's sign-in URL; `/api/mcp/oauth/callback` resolves the `state` only inside the signed-in user's workspace. Tokens refresh automatically through the official MCP SDK.
- **Testing MCP:** `pnpm --filter @agentos/mcp-gateway fake-mcp` runs a reference MCP server (built from the SDK) on port 4020: `/mcp` (no auth), `/secure/mcp` (bearer `test-token`), `/oauth/mcp` (OAuth with an auto-approving login), `/sse` (legacy transport). Playwright starts it automatically.
- **Agent runs execute in the worker** (`executeRun` in `packages/core/src/runtime.ts`). A chat turn records the message, creates a task and a queued run, and enqueues it on the `agent` queue. The loop assembles the PRD §25 context, offers only non-blocked tools (aliased to provider-safe names), validates every tool call's arguments against the tool's JSON Schema (ajv), evaluates policy on every call, wraps tool output as `<tool_output trust="untrusted">`, and enforces budgets (tool calls, runtime, per-task and daily cost; stop or ask for approval). A step that needs approval persists the transcript in `runs.state` and stops; `decideApproval()` re-queues the run, which resumes in a later worker process. `claimRun()` makes duplicate job delivery harmless.
- **Tasks and schedules** live in `packages/core/src/tasks.ts` and `schedules.ts`. Every task state change goes through `updateTaskState()`, which also writes `task_state_history`. When a run finishes, `onTaskRunFinished()` completes the task and starts its dependents, retries transient provider errors with backoff, or fails it (and its dependents). Schedules are registered with BullMQ through the `SchedulerPort` (`scheduler-bullmq.ts`); the database is the source of truth and the worker re-syncs on start. Runs heartbeat while they work; the worker re-queues stale runs every minute.
- **Knowledge and memory** (`packages/core/src/knowledge.ts`, `memory.ts`): sources are read on upload (PDF via `unpdf`, text, Markdown, HTML), then chunked and embedded by the worker's `knowledge` queue. Embeddings come from the workspace's own providers (Settings → Knowledge); every vector is 768-dimensional and stored with the model that made it, so vectors from different models are never compared. Without an embedding model, search is keyword-only (Postgres full text, `simple` config for en + tr). Retrieval fuses vector and keyword rankings (reciprocal rank fusion) and is limited to 5 excerpts / 2,000 tokens. A run retrieves once at start, logs `context.retrieved` with the ids it used, and re-checks before every model call so a memory deleted or disabled mid-run is dropped. Knowledge excerpts reach the model inside `<knowledge trust="untrusted">` tags.
- **Memory is private to its user** (PRD §12): repositories filter on `memories.user_id`; user-scoped knowledge is visible only to its uploader. Deletion is a hard delete. Finished manual and scheduled tasks are remembered as episodic memories; chat turns are not.
- **Feedback learning** (`feedback.ts`): Reject / Revise / Feedback with a comment creates a _suggested_ rule and, when the comment matches a known phrase (en + tr), a personality change of ±20 on one trait. Nothing applies until the user accepts it; accepted personality changes go through `updatePersonality()` (versioned, audited before/after).
- **URL fetching** (`fetch-url.ts`): http(s) only, every redirect re-checked, private/loopback/link-local addresses refused unless `AGENTOS_ALLOW_PRIVATE_URLS=1`, 5 MB and 15 s limits. Known gap: DNS is resolved separately for the check and the connection.
- **Live updates:** `/api/runs/[id]/events` streams a run's events (server-sent events) until it settles; the chat refreshes when it does. Token-by-token streaming is not implemented yet.
- **Personality eval against a real model:** `pnpm --filter @agentos/core eval:personality` (needs `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` + `EVAL_MODEL`, or `EVAL_PROVIDER=ollama`). It compares a terse/skeptical agent with a verbose/credulous one and fails if answers aren't measurably shorter and more hedged.
- **Dev server caches services on `globalThis`** to survive hot reloads; restart `pnpm dev` after changing `apps/web/src/server/services.ts`.
- **Changing the schema:** edit `packages/db/src/schema`, run `pnpm db:generate`, then rename the new migration to something descriptive and update `migrations/meta/_journal.json` to match.
