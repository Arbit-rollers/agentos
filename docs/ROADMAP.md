# AgentOS — Build Roadmap

**Companion to:** `AgentOS_PRD_v1.2.md` (§34 Release Plan)
**Created:** 2026-10-06
**Approach:** thin vertical slice first (v0.1), then expand. Each milestone ends in a working, demo-able state with tests.

Legend: **AC n** = acceptance criterion n in PRD §28. **Screen n** = screen n in `AgentOS Dark-Mode AI Dashboard Collage.png` (PRD §0.3).

---

## Overview

| Release | Milestone | Theme | Screens | AC |
|---------|-----------|-------|---------|----|
| v0.1 | M0 | Scaffolding | — | — |
| v0.1 | M1 | Foundation: auth, tenancy, secrets, audit | — | 1, 2 |
| v0.1 | M2 | App shell, design system, i18n, dashboard | 1 | — |
| v0.1 | M3 | Agents + Personality | 4 | 3, 4, 5 |
| v0.1 | M4 | Model Gateway | — | 6, 7, 8, 9, 10, 11, 12 |
| v0.1 | M5 | MCP Hub + Tool Permissions | 2, 3, 5, 6 | 13, 14, 15, 16 |
| v0.1 | M6 | Runtime, Chat, Approvals, Logs, Budgets | 7 | 17, 18, 22, 23, 24 |
| v0.2 | M7 | Tasks & Schedules | 8 | — |
| v0.3 | M8 | Knowledge, Memory, Feedback Learning | — | 21 |
| v0.4 | M9 | Multi-Agent Orchestration | — | 19, 20 |
| v0.4.1 | M9.5 | Per-user connections & Google Workspace | 2, 3 | 13, 15 (per user) |
| v0.4.2 | M9.6 | Workspace invitations & roles | — | 1, 2 (multi-user) |
| v0.4.3 | M9.7 | Role restrictions | — | 2, 15 |
| v0.5 | M10 | Workflows | 9 | 25 |
| v0.6 | M11 | Intelligence, Analytics, Hardening | — | 26 |

**Done when v0.1 ships:** a new user registers, connects a model provider and a remote MCP server, creates an agent with a personality and model through the wizard, assigns tools with permissions, chats with the agent, sees it call tools, approves a risky call from the Approval Inbox, and inspects the run, tokens, and cost.

---

## v0.1: Thin Vertical Slice

### M0: Scaffolding ✅

**Scope**
- pnpm monorepo: `apps/web`, `apps/worker`, `packages/{db,core,model-gateway,mcp-gateway,policy,ui,i18n}`
- TypeScript strict, ESLint (incl. rule: no direct table access outside `packages/db`), Prettier
- Next.js App Router + Tailwind + shadcn/ui in `apps/web`
- Drizzle + migration runner; BullMQ worker skeleton
- `docker-compose.yml`: `web`, `worker`, `postgres` (pgvector image), `redis`; `.env.example` (incl. `AGENTOS_MASTER_KEY`)
- Vitest + Playwright setup; GitHub Actions CI (lint, typecheck, test)
- `git init`, README with "run locally" steps

**Definition of done**
- `docker compose up` starts all services; web shows a placeholder page; worker processes a ping job.
- CI is green on an empty test suite plus one smoke test.

---

### M1: Foundation ✅

**Scope**
- Tables: `users` (incl. `locale`), `workspaces`, `workspace_members` (owner only for now), `sessions`, `secrets`, `audit_logs`
- Email/password register/login/logout; Argon2id; httpOnly session cookies
- Default private workspace created on registration
- `tenantScope(ctx)` helper; request context carries `user_id` + `workspace_id`
- Secret store: AES-256-GCM envelope encryption, `secret_ref` only in domain tables
- Audit primitive `audit(ctx, action, target, outcome)`
- Logger with secret redaction

**Covers:** AC 1, AC 2

**Definition of done**
- E2E: two users register; each sees only their own workspace.
- Integration test suite "tenant isolation": for each resource API, user B's request for user A's ID returns 404 (grows with every later milestone).
- Unit tests: encrypt/decrypt round trip; ciphertext never equals plaintext; logger redacts known secret patterns.

---

### M2: App Shell, Design System, i18n, Dashboard ✅

**Scope**
- Design tokens (PRD §35) in Tailwind config; dark theme
- `packages/ui`: sidebar, top bar, page header, card, stat tile, status badge, data table with filter tabs, stepper, toggle, select, slider, empty states
- 12-item sidebar navigation (PRD §3); placeholder pages for routes not built yet
- `⌘K` command palette (navigation only in v0.1)
- next-intl with `en` + `tr` catalogs; locale switch in Settings → Profile; CI check for missing keys
- Dashboard (Screen 1): greeting, KPI tiles (active agents, running tasks, MCP connections, success rate), active agents strip, recent activity, task overview chart. Real counts from DB; empty states when zero.

**Screens:** 1

**Definition of done**
- Dashboard renders in both locales with no missing keys.
- Playwright visual check of shell at desktop width; keyboard navigation through sidebar works.

---

### M3: Agents + Personality ✅

**Scope**
- Tables: `agents` (+ `avatar`, `description`, `tags`), `agent_personalities`
- Agent service: CRUD, lifecycle (Draft → Configured → Active → Paused → Archived), hierarchy (`parent_agent_id`, cycle prevention)
- Personality engine:
  - 15 traits (0–100), 9 presets (PRD §6.4)
  - **Directive compiler**: trait scores → bounded runtime directives (communication, verification, escalation, autonomy, collaboration) per PRD §6.3; deterministic; versioned
  - Priority guard: personality directives are placed below policy/role layers (PRD §6.5) and cannot contain permission grants
- Agents list page (cards: avatar, name, role, status)
- Create Agent wizard steps 1, 2 (personality part), 5 (Screen 4); steps 3–4 stubbed until M5; model part of step 2 completed in M4
- Wizard draft persistence after step 1
- Audit events: agent created/updated, personality changed

**Screens:** 4

**Covers:** AC 3, AC 4, AC 5

**Definition of done**
- User creates several agents with different presets/traits.
- Unit/golden tests: different trait vectors produce different compiled directives; extreme values stay within bounds; no directive text grants tools/permissions.
- (End-to-end behavior difference is verified again in M6 once the runtime exists.)

---

### M4: Model Gateway ✅

**Scope**
- Tables: `provider_connections`, `model_configs`, `model_routes`, `model_fallbacks`, `model_capabilities`
- Settings → AI Providers: add/test/remove OpenAI, Anthropic, Google, Ollama (base URL), OpenAI-compatible; keys stored via secret store
- Provider adapter interface: `generate`, `stream`, tool-calling, structured output, token usage
- Capability registry (seeded + refreshed from provider model lists where available)
- Strategies: **Fixed**, **Fallback Chain** (outage, rate limit, timeout, context limit, cost threshold, unsupported modality), **Smart Router v1** (rule-based: task category → route, with capability check)
- Every model call writes a run event: selected provider/model, strategy, routing reason, fallback events
- Cost estimation from pricing metadata
- Wizard step 2 model section + Settings drawer "AI Brain" section
- Audit: model config changes

**Covers:** AC 6, 7, 8, 9, 10, 11, 12

**As built (deviations from the scope above)**
- The capability registry is code (`packages/model-gateway/src/registry.ts`: published Anthropic prices and limits) plus each connection's discovered model list stored on `provider_connections.models`, instead of a `model_capabilities` table. Unknown prices show as "cost unknown", never estimated.
- `runs` and `run_events` were introduced here (planned for M6) so routing and fallback events have a home; M6 extends them for tasks and tool calls.
- Streaming and tool calling move to M6 with the agent runtime; M4 adds a "Try this agent" test prompt on the agent page.
- Daily budgets are stored but enforced in M6; the per-task limit already skips models whose estimated cost is higher.

**Definition of done**
- Agent A on a cloud model and agent B on local Ollama both answer a test prompt.
- Switching an agent's model leaves personality, role, tools, memory unchanged (integration test).
- Simulated provider failure triggers fallback and records the event.
- Router test: two task categories route to two different models, with logged reasons.
- Test: assembled prompts and logs never contain any stored API key (scan for secret values).

---

### M5: MCP Hub + Tool Permissions ✅

**Scope**
- Tables: `mcp_connections`, `mcp_tools`, `agent_tool_permissions`
- MCP Gateway using the official TypeScript SDK: Streamable HTTP + SSE transports; auth types none / bearer / headers / OAuth 2.1 PKCE
- Connect, Test Connection, Refresh Tools, Disable, Disconnect; worker-based health checks
- Tool discovery → normalized schemas stored; resources listed
- MCP Hub (Screen 2) with tabs All / Connected / Available / Custom / AI Providers (provider cards read from `provider_connections`)
- Connection Detail (Screen 3): Overview / Tools / Authentication / Settings / Logs; workspace-default permission per tool
- Wizard step 3 MCP Tools (Screen 5) and step 4 Permissions & Approval Settings (Screen 6); default classification (read → Auto Allow, high-risk → Approval Required, destructive → Blocked)
- Policy engine v1 (`packages/policy`): `evaluate(agent, tool, args) → ALLOW | REQUIRE_APPROVAL | BLOCK` — agent permission can only be the same as or stricter than the workspace default
- Audit: connection changes, permission changes

**Screens:** 2, 3, 5, 6

**Covers:** AC 13, 14, 15, 16

**As built (notes)**
- OAuth 2.1 (discovery, dynamic client registration, PKCE, refresh) is in M5, as decided with the product owner.
- The enforced tool-call path (`executeAgentTool`) exists now; APPROVAL_REQUIRED calls are refused until M6 adds approval requests and the inbox. Tool calls are recorded in `audit_logs`; the `tool_calls` table arrives with the runtime in M6.
- Agents get an `approval_policy` (high-risk categories that always need approval), edited on wizard step 4.

**Definition of done**
- Connect a test remote MCP server (repo includes a small fixture server); tools appear in Hub and Detail.
- Tools assigned to agent A are not available to agent B.
- Executing a BLOCKED tool through the gateway is rejected server-side and logged (test bypasses UI).
- No tool is exposed to any agent right after a connection is added.

---

### M6: Runtime, Chat, Approvals, Logs, Budgets ✅

**Scope**
- Tables: `tasks` (minimal: chat-originated), `runs`, `run_events`, `tool_calls`, `approval_requests`
- Agent Runtime: context assembly in PRD §25 order; tool loop with policy check on every call; external content marked untrusted (prompt-injection guard: tool output cannot alter policy)
- Runs execute in the worker; UI streams events (SSE)
- Agent Workspace (Screen 7): header, tabs Chat / Tasks / Tools / Files / Memory / Logs (Files and Memory are placeholders until v0.3), Available Tools panel, rich output cards, tool-call chips, Settings drawer
- Approval flow: APPROVAL_REQUIRED → run paused (`Waiting for Approval`) → Approval Inbox (Approve Once / Reject / Edit & Approve) → resume or fail; inline approval card in chat
- Budgets: per-agent daily $ and per-task $, max tool calls, max runtime; on exceed → Stop or Request Approval
- Tool failures are recorded as failures, and the result passed back to the model is marked as an error
- Logs page + agent Logs tab: runs, events, tool calls, model routing, tokens, cost
- Dashboard KPIs wired to real run data

**Screens:** 7

**Covers:** AC 17, 18, 22, 23, 24

**As built (notes and known gaps)**
- Chat creates a task per turn; the Tasks page lists them (creating/scheduling tasks directly is v0.2).
- Live updates stream run *events* over SSE; token-by-token model streaming is not implemented.
- Chat runs use the `general` task category, so Smart Router per-category routes don't apply to chat yet (primary + fallbacks do). Category selection or classification is a follow-up.
- The personality eval against a real model is a script (`eval:personality`); it needs a provider key and has not been run in this environment. Automated tests verify the directives reach the model.
- Rich output cards: assistant replies render as Markdown (no raw HTML). Domain-specific cards (script/storyboard) remain the open M6 question below.

**Definition of done (= v0.1 done)**
- The full v0.1 flow (see Overview) passes as one Playwright E2E test against the fixture MCP server and a mocked or local model.
- An APPROVAL_REQUIRED tool never runs before approval (test calls the API directly).
- Approval decisions appear in audit logs with approver and timestamp.
- Budget exceeded → run stops or creates an approval request, per policy.
- Two agents with opposite personalities give measurably different responses to the same prompt (e.g. length for Concise, number of verification steps for Skeptical) — eval test.

---

## v0.2: Tasks & Schedules (M7) ✅

- Full task model (PRD §14): objective, input, priority, dependencies, budget, due date, all 8 states
- BullMQ task queue, retries, cancel; recovery after worker restart
- Tasks screen (Screen 8): filter tabs All / Running / Scheduled / Completed / Failed with counts; New Task dialog
- `schedules` table: one-time and recurring (cron + IANA timezone); manual run
- Agent Tasks tab populated

**DoD:** recurring schedule fires on time across a restart; task state history is visible; failed tasks show the error.

**As built (notes and known gaps)**
- Tasks: New Task dialog (Tasks page and agent Tasks tab) with details, priority, due date, dependencies and retries; task detail page with Markdown output, error, runs and a state history (`task_state_history`, one row per transition with a note).
- Dependencies: a task with unfinished dependencies waits (`waiting_for_agent`) and starts when they complete; if one fails, its dependents fail with `dependency_failed`.
- Retries: only transient provider errors (`provider_*`) retry automatically, with backoff 30 s · 4ⁿ⁻¹, up to the task's `maxRetries` (scheduled tasks: 2). Chat tasks never retry. Failed or cancelled tasks can be retried by hand.
- Cancel stops queued/running runs at the next step and rejects pending approvals (`task_cancelled`).
- Recovery: runs send a heartbeat; the worker's `runs.recover` job (every 60 s) re-queues runs whose heartbeat is older than 2 minutes. Tool calls that were in flight are reported to the model as interrupted rather than silently re-run.
- Schedules: BullMQ job schedulers (`schedule-<id>`, cron + IANA timezone) and delayed jobs for one-time schedules (`once-<id>`); the worker syncs them on start and fires missed one-time schedules. Builder: hourly / daily / weekly / custom cron, or a date and time. Run now, pause/resume, delete.
- The DoD's "fires across a restart" is covered by a Redis-backed test (one worker closed abruptly, a second one keeps firing; a one-time schedule fires exactly once).
- Filter tabs are All / Running / Waiting / Completed / Failed; scheduled work shows as the "Scheduled" type column rather than a tab. Per-task budgets come from the agent's budgets; a per-task budget override is not in this release.

---

## v0.3: Knowledge, Memory, Feedback Learning (M8) ✅

- `knowledge_sources`: upload PDF/text/notes, URLs; scopes User / Workspace / Agent; ingestion jobs → chunk → embed (pgvector)
- Retrieval inserted into runtime context (relevant only; never the whole database)
- `memories`: Working, Episodic, Semantic, Procedural; provenance + confidence
- Memory page + agent Memory tab: search, edit, pin, disable, delete
- Agent Files tab = agent-scoped knowledge + artifacts
- `feedback_events`: Approve / Reject / Revise / Feedback on outputs → suggested memory or personality change (e.g. "Concise 55 → 75") → user approval → versioned change + audit

**Covers:** AC 21
**DoD:** deleted memory never appears in later runs; personality suggestions never apply without approval.

**As built (notes and known gaps)**
- Knowledge: notes, file uploads (PDF, text, Markdown, CSV, JSON, HTML; 10 MB) and web pages, scoped Workspace / Agent / Only me. Project scope waits for projects. Scanned PDFs (no text layer) are rejected; there is no OCR.
- Embeddings use the workspace's own provider connection (OpenAI, Google, Ollama, OpenAI-compatible) at a fixed 768 dimensions; models that produce another size are rejected when chosen. Changing the model re-indexes every source and memory in the background. Without a model, search is keyword-only.
- Retrieval is hybrid (pgvector cosine + Postgres full text, merged by reciprocal rank fusion). Pinned and procedural memories always apply; other memories and knowledge only when relevant.
- Memory layers: working = the run's own state; episodic = finished manual/scheduled tasks (chat turns are not stored); semantic and procedural = added by hand or accepted from feedback. Memory is private to the user who owns it.
- Feedback: Approve / Reject / Revise / Feedback under every answer. Suggestions are a rule (the comment) and, for recognised phrases in English or Turkish, one personality trait ±20. Revise also asks the agent to redo the answer. Suggestions are accepted or dismissed in the chat or on the Memory page.
- Run log shows which memories and knowledge sources each run used (`context.retrieved`).
- Local setup: pgvector 0.8.7 was built for Homebrew Postgres 15 (README).
- The chat's live updates now reconnect after a dropped stream instead of waiting for a manual reload.

---

## v0.4: Multi-Agent Orchestration (M9) ✅

- Master Orchestrator and Manager runtime behaviors: decompose goal → subtasks → select authorized agents → delegate → monitor → synthesize
- Child tasks with `parent_task_id`; minimal context handoff
- Delegation permitted only to agents the user authorized; **no permission inheritance**
- Delegation tree view in task detail

**Covers:** AC 19, AC 20
**DoD:** "Create tomorrow's Pilots Quest reel" style demo runs across 3+ agents with one approval step; a child agent cannot use a tool only its parent has.

**As built (notes and known gaps)**
- Authorization = the reporting hierarchy from the wizard: an orchestrator or manager may delegate only to its direct reports that are Configured/Active and have a working model. Managers delegate onward to their own reports (orchestrator → manager → specialist). Specialists and system agents get no delegate tool.
- Decomposition, agent selection and synthesis are done by the leading agent's model through the `delegate_task` tool (parallel calls allowed); the runtime enforces who, how deep (3 levels) and how many (8 per run).
- Minimal handoff: a child task holds only the objective and details from the call. Children use their own tools, permissions, memory scope and budgets; nothing passes down from the parent (AC 20, tested).
- The parent run waits as `waiting_agents` and resumes when all children have finished; child answers are wrapped as untrusted data. Failed or cancelled children come back as errors the parent can handle.
- Task detail shows the delegation tree and links children to their parent; run logs show delegation started / finished / refused; the chat shows which team members it is waiting for.
- Known gaps: the parent's per-task budget does not include its children's cost (each child counts against its own agent's budgets); there is no delegation to agents outside the direct-report line, and no per-agent override of that rule.

---

## v0.4.1: Per-user Connections & Google Workspace (M9.5) ✅

Lets every tenant, and every person in it, connect their own accounts to shared MCP servers. Google Workspace is the first catalog entry built on it.

- **Per-user credentials:** an MCP connection is added once per workspace, but its sign-in can be *per user* ("Connect my account") or *shared* (one service account, the current behaviour). Per-user tokens are stored encrypted, bound to workspace + user + connection.
- **Runtime picks the right identity:** a tool call uses the credentials of the person the run acts for (chat author, task creator, schedule creator; delegated tasks inherit the requesting person, never the parent agent's permissions). A person who has not connected gets "Connect your account to use this tool", never someone else's data. Tool discovery uses the admin's connection.
- **OAuth with a pre-registered client:** client ID, client secret and scopes for servers without dynamic client registration (Google), alongside the existing DCR flow. Secrets live in the secret store.
- **Google Workspace catalog template:** Google's hosted MCP servers (Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat, People) with the right scopes per service; the tenant picks services. Client choice: the AgentOS platform OAuth client (from env) or the tenant's own client ("bring your own", needs no Google verification for Internal apps).
- **MCP Hub UX:** per-user connection status ("Connected as you@domain" / "Connect my account"), disconnect / revoke for yourself; admins see who has connected (not their tokens).
- **OpenArt fixes:** a 401 with `WWW-Authenticate: … resource_metadata` on a "None" connection reports "This server requires sign-in (OAuth)"; a connection's authentication type can be changed without removing it.

**Covers:** AC 13, 15 per user (no cross-user credential use)
**DoD:** two members of one workspace connect different Google accounts to the same Gmail connection; each one's agent reads only their own mailbox (tested against a fake OAuth + MCP server); a scheduled task uses its creator's account; a member who hasn't connected is told to connect, not served another member's data; revoking removes the token and the next call asks to connect again.

**Outside our control:** Google's Workspace MCP servers are in the Developer Preview Program; using the AgentOS platform client with Gmail/Drive in production needs Google app verification plus a CASA security assessment. Until then: tenant-owned clients, or test mode (up to 100 test users).

**As built (notes and known gaps)**
- Per-user mode works for OAuth and token connections; headers and "None" stay shared. The person a run acts for is `ctx.userId` (chat author, task creator, schedule creator; delegated tasks keep the requester). There is no fallback to another member's credentials.
- Tool discovery for a per-user connection uses the account of whoever connects or refreshes it; the hourly health check uses the connection owner's.
- Google Workspace creates one connection per service (Google runs one MCP server per product), so each member signs in once per service. The scopes and endpoints follow Google's published configuration; the flow is tested against a Google-like fake server, not against Google.
- Workspace invitations don't exist yet (every sign-up gets its own workspace), so "two members, two accounts" is covered by tests that add a member directly. Invitations are the next prerequisite for teams.
- Revoking at the provider is not called on disconnect; AgentOS deletes its stored tokens.

---

## v0.4.2: Workspace Invitations & Roles (M9.6) ✅

Makes multi-user workspaces real, so per-user connections and private memory matter in practice.

- Settings → Members: members with roles, invite by email (Admin or Member), pending invitations (revoke), change roles, remove members, leave, rename the workspace
- Invitation links: single use, 7 days, token stored hashed, only the invited email can accept; sign-in and registration return to the link (`?next=`, same-site paths only)
- Top-bar workspace switcher; the session remembers the current workspace and falls back to the person's own one if they are removed
- Leaving or removal deletes that person's memories, private knowledge and own MCP credentials in the workspace and pauses their schedules; shared work stays

**As built (notes and known gaps)**
- No email delivery: the inviter copies the link. Email (SMTP or a provider) is a follow-up.
- Roles gate member management only. Agents, tools, approvals and settings are open to every member; Viewer exists in the schema but isn't offered.
- One owner per workspace; ownership transfer and workspace deletion are not built.
- Signing in lands in the person's oldest workspace; the switcher changes it for that session.

---

## v0.4.3: Role Restrictions (M9.7) ✅

| Area | Owner / Admin | Member |
|---|---|---|
| AI providers, embedding model, MCP servers (add, remove, sign-in method, tool defaults), members | ✅ | view only; connects **their own account** on per-member servers |
| Agents | create, edit any | create; edit / activate / archive **their own** |
| Approvals | decide any | decide those for **their own** runs |
| Tasks & schedules | cancel / retry / pause / delete any | create; manage **their own** |
| Knowledge | any scope; manage any | "Only me", and "One agent" on their own agents; manage their own |
| Chat, memory, feedback | ✅ | ✅ (memory stays private) |

**As built (notes and known gaps)**
- Enforced in core (`permissions.ts`) on every call, so the API, server actions and worker paths can't bypass it; the UI hides refused controls. Worker jobs (health checks, schedule firings, recovery) are system actions and aren't role-checked.
- Chat tasks now record who started them (backfilled from conversations by migration 0015), so approvals and cancellation reach the right person.
- A member who gives feedback on someone else's agent can accept the suggested rule (it's their memory) but not the personality change; that needs the agent's creator or an admin.
- Viewer (read-only) is still not offered.

---

## v0.5: Workflows (M10)

- Workflow Builder (Screen 9) with React Flow: nodes Agent, MCP Tool, Model, Condition, Human Approval, Transform, Delay, Schedule, Output; agents/tools palette; settings panel (name, description, trigger, schedule, active)
- Graph validation, execution engine on the worker, versioning, test run, activate/deactivate, workflow logs

**Covers:** AC 25
**DoD:** a saved workflow is versioned, test-run, activated, and run on schedule.

---

## v0.6: Intelligence, Analytics, Hardening (M11)

- Smart Router policies (cost/latency/capability-aware), fallback optimization
- Analytics page: tokens, cost by agent/model/provider, success rates, agent performance
- stdio MCP via sandboxed per-workspace runner + admin allowlist
- Audit coverage review: every event type in PRD §22 is verified to be recorded
- Reliability: rate limiting, backpressure, crash recovery, backup/restore docs

**Covers:** AC 26
**DoD:** audit-coverage test enumerates every PRD §22 event type and asserts that each one produces an audit/run entry.

---

## Traceability: PRD §27 "MUST ship" → release

| §27 item | Release |
|----------|---------|
| multi-user authentication, strict tenant isolation | v0.1 (M1) |
| private user dashboard | v0.1 (M2) |
| agent CRUD, agent types, reporting hierarchy | v0.1 (M3) |
| personality engine, presets, custom traits | v0.1 (M3) |
| per-agent model selection, Fixed, Smart Router architecture, Fallback Chain | v0.1 (M4) |
| provider connection management, local Ollama support | v0.1 (M4) |
| MCP Hub, custom MCP connections, tool discovery, per-agent tool permissions | v0.1 (M5) |
| agent runtime, approval inbox, budgets, logs, token usage | v0.1 (M6) |
| task system | v0.1 (basic, M6) → v0.2 (full) |
| schedules | v0.2 |
| knowledge system, inspectable memory, feedback learning | v0.3 |
| basic multi-agent delegation | v0.4 |
| workflow builder | v0.5 |
| cost analytics | v0.1 (per-run cost, M6) → v0.6 (analytics) |

## Open product questions (to resolve before the milestone that needs them)

| Needed by | Question |
|-----------|----------|
| ~~M3~~ | ~~Avatar source~~ → **Decided in M3:** built-in preset gallery (12 icon avatars, stored as `preset:<key>`). Uploads can be added later without a schema change. |
| ~~M5~~ | ~~Available catalog~~ → **Decided in M5:** curated templates (Google Workspace, GitHub, Notion, Slack, Linear, Instagram, YouTube) that pre-fill name and OAuth; the user pastes the server URL from the provider's docs (no guessed URLs). |
| M6 | Rich output cards (script / storyboard / video): generic card schema, or domain-specific renderers? |
| v0.2 | Event/condition triggers ("when new file arrives"): which event sources first? |
| v0.3 | Embedding model default: cloud or local (e.g. Ollama `nomic-embed-text`)? |
