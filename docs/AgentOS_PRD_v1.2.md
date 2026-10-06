# AgentOS --- Product Requirements Document

**Version:** 1.2\
**Status:** Decision-locked, implementation-ready\
**Product type:** Multi-user, personality-driven, MCP-first AI Agent
Operating System\
**Deployment target:** Local-first web application with optional cloud
LLM and remote MCP connectivity

------------------------------------------------------------------------

## 0. Changelog & v1.2 Decisions

### 0.1 Changes from v1.1

| \# | Section | Change |
|----|---------|--------|
| 1 | §0 | Added changelog and locked v1.2 decisions. |
| 2 | §8.1 | MCP Hub gains an **AI Providers** filter tab; provider cards stay architecturally separate from MCP. |
| 3 | §8.2 | v0.1 transport scope: Streamable HTTP + SSE only; stdio deferred. |
| 4 | §19 | Agent Creation Wizard reduced from 10 to **5 steps** (matches visuals); all 10 PRD concerns folded in. |
| 5 | §20 | Agent Detail reduced to **6 visible tabs** + Settings drawer; no PRD capability removed. |
| 6 | §29 | Recommended stack replaced with a **locked concrete stack** and security implementation notes. |
| 7 | §33 (new) | Internationalization: English + Turkish from day one. |
| 8 | §34 (new) | Release plan: thin vertical slice v0.1, then v0.2–v0.6. Supersedes §27 "all MUST ship at once" and maps onto §30 phases. |
| 9 | §35 (new) | Design system derived from the approved dark-mode visuals. |
| 10 | §23 | `users.display_name` added (dashboard greeting, Screen 1); set at sign-up and in Settings → Profile. |

### 0.2 Locked v1.2 Decisions

These extend §31 and are locked unless changed by the product owner.

| Topic | Decision |
|-------|----------|
| Product name | **AgentOS** (repository directory name "DeyLa" is not user-facing). |
| Visuals vs PRD | **Visuals are the source of truth for UX; this PRD is the source of truth for logic, data, security, and architecture.** |
| MVP strategy | **Thin vertical slice first (v0.1)**, then expand milestone by milestone (§34). |
| Language | **English + Turkish UI from day one**; English is the default. |
| Stack | pnpm monorepo · Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Drizzle ORM · PostgreSQL + pgvector · Redis + BullMQ · Docker Compose. |
| First deployment | Local machine via Docker Compose (host Ollama reachable). |
| MCP transports | **Remote HTTP (Streamable HTTP / SSE) only in v0.1.** stdio added later via sandboxed per-workspace processes. |

### 0.3 Visual Reference

`AgentOS Dark-Mode AI Dashboard Collage.png` defines nine reference screens:

| \# | Screen | Sections | Milestone |
|----|--------|----------|-----------|
| 1 | Dashboard | §4 | M2 (v0.1) |
| 2 | MCP Hub | §8.1 | M5 (v0.1) |
| 3 | MCP Connection Detail | §8.3, §9 | M5 (v0.1) |
| 4 | Create Agent — Basic Info | §19 | M3 (v0.1) |
| 5 | Create Agent — MCP Tools | §19 | M5 (v0.1) |
| 6 | Create Agent — Permissions & Approval | §9, §10, §19 | M5 (v0.1) |
| 7 | Agent Workspace (Chat & Tools) | §20 | M6 (v0.1) |
| 8 | Tasks | §14 | v0.2 |
| 9 | Workflow Builder | §16, §17 | v0.5 |

Sample content in the visuals (Turkish text, "Pilots Quest" agents) is
illustrative seed data, not required product content.

------------------------------------------------------------------------

## 1. Product Vision

AgentOS is a web-based operating system where each user can create,
configure, train, organize, supervise, and automate a private workforce
of AI agents.

Each agent is a persistent software entity with:

-   a name and identity
-   an agent type and reporting hierarchy
-   a role
-   a job description
-   goals and constraints
-   a real behavioral personality
-   its own AI model configuration
-   MCP tools and permissions
-   knowledge sources
-   long-term and task memory
-   budgets and runtime limits
-   tasks, schedules, workflows, and execution history

The application is **local-first**, but individual agents may use cloud
models, local models, remote MCP servers, local MCP servers, or
combinations of them.

### Core promise

A non-technical user should be able to create an agent, define what it
does and how it behaves, choose its AI brain, connect tools, teach it
through knowledge and feedback, assign work, and inspect the complete
execution history without writing integration code.

### Design principles

1.  Multi-user from day one.
2.  Strict tenant isolation.
3.  Personality is executable behavior, not decoration.
4.  Model choice is per-agent.
5.  MCP is the default integration abstraction.
6.  Least-privilege tool access.
7.  Human approval for risky external actions.
8.  Model/provider independence.
9.  Persistent, inspectable memory.
10. Composable multi-agent workflows.
11. Local-first control with cloud capability.
12. Every important autonomous action must be observable and auditable.

------------------------------------------------------------------------

## 2. Multi-User Architecture

The system MUST support multiple authenticated users.

Every user receives a private environment containing:

-   dashboard
-   agents
-   MCP connections
-   model/provider configurations
-   tasks
-   workflows
-   schedules
-   approvals
-   knowledge
-   memories
-   generated artifacts
-   execution logs
-   analytics
-   API usage and cost information

### Tenant isolation

All server-side queries MUST be scoped using `user_id` and/or
`workspace_id`.

User A MUST NOT be able to discover, retrieve, execute, modify, or
delete User B's resources by manipulating frontend IDs or API requests.

### Workspace model

MVP:

-   one private default workspace is automatically created per user
-   schema must support multiple workspaces later
-   schema must support team membership later without major redesign

Future workspace roles may include:

-   Owner
-   Admin
-   Member
-   Viewer

------------------------------------------------------------------------

## 3. Main Navigation

Primary navigation:

1.  Dashboard
2.  Agents
3.  MCP Hub
4.  Tasks
5.  Workflows
6.  Knowledge
7.  Memory
8.  Approvals
9.  Schedules
10. Logs
11. Analytics
12. Settings

------------------------------------------------------------------------

## 4. User Dashboard

Each user sees only their own operational environment.

Dashboard should include:

-   active agents
-   paused agents
-   running tasks
-   completed tasks
-   failed tasks
-   pending approvals
-   MCP connection health
-   scheduled automations
-   recent activity
-   agent success rate
-   token usage
-   estimated API cost
-   model/provider usage
-   alerts
-   recent agent outputs

------------------------------------------------------------------------

# 5. Agent System

## 5.1 Agent Types

### Master Orchestrator

Responsible for:

-   understanding high-level goals
-   decomposing goals into tasks
-   selecting appropriate agents
-   delegating work
-   monitoring execution
-   requesting human approval where necessary
-   combining outputs
-   reporting final results

A Master Orchestrator is **not a system superuser**.

It can only access agents, tools, models, data, and workflows permitted
by user policy.

### Manager Agent

Responsible for a domain or group of specialist agents.

Examples:

-   Content Director
-   Development Manager
-   Research Manager
-   Personal Operations Manager

### Specialist Agent

Performs focused work.

Examples:

-   Researcher
-   Script Writer
-   Developer
-   Aviation Fact Checker
-   Video Producer
-   Financial Analyst

### System Agent

Optional internal utility agent.

Examples:

-   Memory Curator
-   QA Agent
-   Monitoring Agent
-   Scheduler
-   Cost Optimizer

------------------------------------------------------------------------

## 5.2 Agent Profile

Every agent contains:

``` text
id
workspace_id
owner_user_id
name
avatar
description
agent_type
role
job_definition
goals
constraints
personality_profile
model_strategy
model_configuration
fallback_models
parent_agent_id
knowledge_sources
memory_policy
MCP tools
tool permissions
budgets
schedule settings
status
created_at
updated_at
```

Agent lifecycle:

``` text
Draft
→ Configured
→ Active
→ Paused
→ Archived
```

------------------------------------------------------------------------

# 6. Personality Engine

Personality is a core runtime feature.

It MUST influence how an agent:

-   communicates
-   evaluates evidence
-   handles uncertainty
-   challenges assumptions
-   makes recommendations
-   collaborates
-   delegates
-   verifies information
-   explores alternatives
-   decides when to escalate
-   uses permitted autonomy

Personality MUST NOT override permissions, security, budgets, or
explicit user instructions.

## 6.1 Role vs Personality

**Role = WHAT the agent does.**

**Personality = HOW the agent does it.**

Example:

``` text
Role:
Aviation Fact Checker

Personality:
Analytical: 95
Skeptical: 95
Creative: 20
Cautious: 90
Concise: 70
Autonomous: 50
Collaborative: 65
```

Another agent may have the same role but behave differently because its
personality differs.

## 6.2 Personality Traits

Each trait is scored from `0–100`.

Initial traits:

-   Analytical
-   Creative
-   Skeptical
-   Assertive
-   Empathetic
-   Cautious
-   Concise
-   Detailed
-   Autonomous
-   Collaborative
-   Proactive
-   Experimental
-   Persistent
-   Formal
-   Humorous

## 6.3 Behavioral Mapping

High `Analytical`:

-   decomposes problems
-   compares alternatives
-   prefers evidence
-   explains causal reasoning

High `Creative`:

-   generates more alternatives
-   explores unconventional approaches
-   combines ideas

High `Skeptical`:

-   verifies claims
-   challenges assumptions
-   requests corroboration
-   reduces unsupported certainty

High `Cautious`:

-   increases verification
-   avoids irreversible actions
-   escalates uncertainty more often

High `Autonomous`:

-   executes permitted steps without unnecessary confirmation
-   does NOT bypass approval-required actions

High `Collaborative`:

-   prefers delegation
-   requests peer review
-   synthesizes other agents' work

High `Concise`:

-   produces shorter responses
-   minimizes unnecessary explanation

High `Experimental`:

-   tests alternatives when budgets and sandbox rules permit

## 6.4 Personality Presets

Initial presets:

-   Analyst
-   Creative Director
-   Executive Assistant
-   Skeptical Reviewer
-   Researcher
-   Engineer
-   Operator
-   Coach
-   Custom

All presets remain editable.

## 6.5 Runtime Priority

Runtime behavior priority MUST be:

``` text
Platform Safety
↓
Tenant / User Permissions
↓
Approval Policy
↓
Workflow Rules
↓
Job Instructions
↓
Role
↓
Personality
↓
Conversation Preference
```

Personality can never grant authority.

## 6.6 Personality Evolution

Agents MUST NOT silently rewrite their permanent personality.

Feedback may generate a suggested personality change.

Example:

``` text
Observed:
User repeatedly asks this agent to be shorter.

Suggested:
Concise 55 → 75
```

The user must approve persistent personality changes.

------------------------------------------------------------------------

# 7. Per-Agent AI Model Selection

This is a mandatory v1 feature.

Every agent MUST be able to use a different AI model.

The user chooses the provider and model while creating an agent or later
from Agent Settings.

Personality, memory, role, tools, and job definition MUST remain
independent from the chosen model.

Changing an agent from one provider/model to another must not erase its
identity or configuration.

------------------------------------------------------------------------

## 7.1 Supported Provider Architecture

AgentOS MUST use a provider-adapter architecture.

Potential providers include:

-   OpenAI
-   Anthropic
-   Google
-   local Ollama
-   OpenAI-compatible local endpoints
-   additional providers through future adapters

Do NOT hard-code orchestration to one model vendor.

------------------------------------------------------------------------

## 7.2 Model Strategy

Each agent supports one of three model strategies.

### A. Fixed Model

The agent always uses a specific configured model.

Example:

``` text
Strategy: FIXED

Provider:
OpenAI

Model:
<user-selected available model>
```

------------------------------------------------------------------------

### B. Smart Router

AgentOS selects a model according to task type and user-defined routing
policy.

Example:

``` text
Strategy: SMART_ROUTER

Research:
Model A

Complex Reasoning:
Model B

Fast / Cheap Task:
Model C

Private / Local Task:
Local Ollama Model

Vision:
Vision-capable Model
```

Routing rules MUST be configurable and observable.

The execution log must record which model was selected and why.

------------------------------------------------------------------------

### C. Fallback Chain

The user defines an ordered model chain.

Example:

``` text
Primary Model
↓
Secondary Model
↓
Local Model
```

Fallback may occur because of:

-   provider outage
-   rate limit
-   timeout
-   context limitation
-   configured cost threshold
-   unsupported modality

Fallback MUST be logged.

AgentOS MUST NOT silently switch models without recording the event.

------------------------------------------------------------------------

## 7.3 Agent Model Configuration

Example UI:

``` text
AI Brain

Strategy
[ Fixed Model ▼ ]

Provider
[ OpenAI ▼ ]

Model
[ Available Models ▼ ]

Temperature
[ 0.4 ]

Max Output
[ Auto ]

Context Policy
[ Smart Context ▼ ]

Fallback
[ Enabled ]

Fallback 1
[ Anthropic / Model ]

Fallback 2
[ Ollama / Local Model ]

Budget
Daily: $2.00
Per Task: $0.50
```

------------------------------------------------------------------------

## 7.4 Provider Credentials

Provider credentials belong to the user/workspace.

They MUST NOT be stored separately inside each agent.

Example:

``` text
USER MODEL PROVIDERS

OpenAI
Connected

Anthropic
Connected

Google
Connected

Ollama
http://localhost:11434
Connected
```

Agents reference configured provider connections.

Raw API keys MUST NOT appear in:

-   prompts
-   memories
-   browser JavaScript
-   ordinary logs
-   agent output

------------------------------------------------------------------------

## 7.5 Model Capability Registry

AgentOS should maintain model capability metadata such as:

``` text
text
reasoning
vision
image_generation
audio
tool_calling
structured_output
context_window
estimated_cost
local/cloud
```

The Smart Router can use these capabilities when selecting a model.

------------------------------------------------------------------------

# 8. MCP-First Architecture

AgentOS acts as an MCP host/client.

MCP connections belong to the user/workspace.

Agents receive permission to use selected tools from those connections.

Architecture:

``` text
USER
 │
 ▼
AgentOS
 │
 ├── Model Gateway
 │
 ├── Personality Engine
 │
 ├── Memory Engine
 │
 ├── Policy Engine
 │
 └── MCP Gateway
       │
       ├── Remote MCP
       ├── Local MCP
       ├── Google Workspace MCP
       ├── GitHub MCP
       ├── Custom MCP
       └── Future MCP Servers
```

------------------------------------------------------------------------

## 8.1 MCP Hub

MCP Hub displays:

-   connection name
-   server type
-   connected status
-   authentication status
-   discovered tool count
-   discovered resources
-   health
-   last check
-   assigned agents

Actions:

``` text
Connect
Test Connection
Refresh Tools
Manage
Disable
Disconnect
View Logs
```

### 8.1.1 MCP Hub Layout (v1.2)

Filter tabs:

``` text
All | Connected | Available | Custom | AI Providers
```

-   MCP servers are displayed as cards: icon, name, status badge, short
    capability summary, tool count, `Manage` / `Connect` button, overflow
    menu.
-   The visuals also show model vendors (OpenAI, Anthropic) as cards.
    These remain in the Hub for discoverability but are shown only under
    the **AI Providers** tab and badged "AI Provider".
-   AI Provider cards are backed by `provider_connections` (§7.4), NOT
    `mcp_connections`. They have no tools to assign and never appear in
    agent MCP tool selection. "Manage" opens the provider settings
    (Settings → AI Providers).
-   Primary action: `+ Connect MCP Server`.

Connection detail screen tabs: `Overview | Tools | Authentication |
Settings | Logs`, with `Test Connection` and `Disconnect` actions. The
Tools tab lists each discovered tool with name, description, default
permission badge (Allowed / Approval Required / Blocked), and an
enable toggle, plus `Refresh Tools`.

The connection-level permission is the **workspace default**. The
effective permission for an agent is set per agent (§9) and can only be
equal to or stricter than the workspace default.

------------------------------------------------------------------------

## 8.2 Custom MCP Connection

Users can configure compatible MCP servers.

Fields may include:

``` text
Name
Server Type
Transport
Endpoint
Authentication Type
Credentials
Advanced Settings
```

Secrets must use encrypted storage.

### 8.2.1 Transport Scope (v1.2)

| Transport | Release | Notes |
|-----------|---------|-------|
| Streamable HTTP | v0.1 | Primary. |
| HTTP + SSE (legacy) | v0.1 | For older servers. |
| stdio (local process) | v0.6 | Requires a sandboxed, per-workspace process runner (container or equivalent), resource limits, no host filesystem access by default, admin-controlled allowlist of commands. |

Authentication types in v0.1: none, API key / bearer token, custom
headers, OAuth 2.1 (authorization code + PKCE) where the server
supports it.

------------------------------------------------------------------------

## 8.3 Tool Discovery

After connection, AgentOS discovers supported MCP capabilities.

Example:

``` text
gmail_search
gmail_read
gmail_create_draft
gmail_send

calendar_list
calendar_create
calendar_update

drive_search
drive_read
drive_upload
```

Tool schemas must be normalized and stored.

------------------------------------------------------------------------

# 9. Agent Tool Permissions

Connecting an MCP server MUST NOT automatically expose all tools to all
agents.

Permissions are configured per agent and per tool.

Modes:

``` text
AUTO_ALLOW
APPROVAL_REQUIRED
BLOCKED
```

Example:

``` text
Research Agent

gmail_search
AUTO_ALLOW

gmail_read
AUTO_ALLOW

gmail_send
BLOCKED

drive_search
AUTO_ALLOW

drive_read
AUTO_ALLOW

drive_delete
BLOCKED
```

Potential future constraints:

-   read-only
-   allowed folders
-   allowed domains
-   rate limit
-   per-run limit
-   allowed hours
-   maximum cost

------------------------------------------------------------------------

# 10. Human Approval System

High-risk actions must support human-in-the-loop approval.

Approval Inbox displays:

-   requesting agent
-   task
-   MCP server
-   tool
-   parameter summary
-   risk level
-   reason
-   estimated cost
-   requested timestamp

Actions:

``` text
Approve Once
Reject
Edit & Approve
```

An `APPROVAL_REQUIRED` tool MUST NOT execute before a valid approval
exists.

Default candidates for approval:

-   send email
-   publish social content
-   delete external files
-   create financial transactions
-   change permissions
-   execute arbitrary code
-   destructive external actions

------------------------------------------------------------------------

# 11. Knowledge & Training

In MVP, "training an agent" means:

``` text
Instructions
+
Knowledge
+
Memory
+
SOPs
+
Examples
+
User Feedback
+
Approved Learned Preferences
```

Model fine-tuning is NOT required.

## Knowledge sources

Users may attach:

-   documents
-   PDFs
-   text files
-   notes
-   URLs
-   datasets
-   SOPs
-   examples
-   future connector resources

Knowledge may be scoped to:

``` text
User
Workspace
Project
Agent
```

------------------------------------------------------------------------

# 12. Memory Architecture

Memory layers:

### Working Memory

Current task/run context.

### Episodic Memory

Past actions, outcomes, failures, corrections, and feedback.

### Semantic Memory

Durable facts and preferences.

### Procedural Memory

Approved workflows, SOPs, and operating rules.

Users must be able to:

-   inspect memory
-   search memory
-   edit memory
-   pin memory
-   disable memory
-   delete memory

No cross-user memory access is allowed.

------------------------------------------------------------------------

# 13. Feedback Learning

Agent outputs support:

``` text
Approve
Reject
Revise
Feedback
```

Feedback creates a learning event.

Example:

``` text
Agent Output
↓
User Rejects
↓
"Too long. Give me only the important information."
↓
Feedback Event
↓
Suggested Memory / Behavior Change
↓
User Approval
↓
Persistent Learning
```

Permanent behavior/personality changes should be auditable.

------------------------------------------------------------------------

# 14. Task System

Task fields include:

``` text
objective
input
assigned_agent
priority
state
dependencies
budget
due_at
outputs
tool_calls
run_history
```

States:

``` text
Draft
Queued
Running
Waiting for Agent
Waiting for Approval
Completed
Failed
Cancelled
```

------------------------------------------------------------------------

# 15. Multi-Agent Orchestration

A Master Orchestrator can:

1.  receive a high-level goal
2.  analyze it
3.  break it into subtasks
4.  select authorized agents
5.  delegate tasks
6.  monitor progress
7.  request approval
8.  handle failures
9.  combine outputs
10. return final result

Example:

``` text
User:
Create tomorrow's Pilots Quest reel.

Master Orchestrator
        │
        ├── Research Agent
        │
        ├── Aviation Fact Checker
        │
        ├── Script Writer
        │
        ├── Creative Director
        │
        └── Video Agent
                  │
                  ▼
           Human Approval
                  │
                  ▼
               Output
```

Delegated agents receive only necessary context.

A parent agent does NOT automatically transfer its tool permissions to
child agents.

------------------------------------------------------------------------

# 16. Workflow Builder

Provide a visual node-based workflow editor.

Node types:

-   Agent
-   MCP Tool
-   Model
-   Condition
-   Human Approval
-   Transform
-   Delay
-   Schedule
-   Output

Example:

``` text
Research Trend
      ↓
Validate Topic
      ↓
Write Script
      ↓
Fact Check
      ↓
Generate Video
      ↓
Quality Review
      ↓
Human Approval
      ↓
Publish
```

Workflows must support:

-   save
-   edit
-   version
-   test run
-   activate/deactivate
-   logs
-   schedules

------------------------------------------------------------------------

# 17. Schedules & Automation

Tasks/workflows may run:

-   manually
-   once at a scheduled time
-   recurring schedule
-   later via event trigger
-   later via condition trigger

Examples:

``` text
Every Monday 09:00
Research aviation trends

Every day 18:00
Prepare tomorrow's content

When new file arrives
Analyze document
```

------------------------------------------------------------------------

# 18. Budgets & Runtime Limits

Per-agent and per-task limits should support:

-   token budget
-   monetary budget
-   maximum tool calls
-   maximum runtime
-   retry count
-   model restrictions

When a budget is exceeded:

``` text
STOP
or
REQUEST APPROVAL
```

depending on user policy.

------------------------------------------------------------------------

# 19. Agent Creation Wizard

**v1.2: 5 steps** (from the approved visuals). All ten v1.1 concerns are
kept; they are grouped into five steps.

``` text
1. Basic Info
2. Model & Personality
3. MCP Tools
4. Permissions
5. Review
```

| Step | Contents | v1.1 steps covered |
|------|----------|--------------------|
| 1. Basic Info | Name\*, Description\*, Agent Type (Master Orchestrator / Manager / Specialist; System is internal), Avatar (upload or preset gallery), Tags, **Reports to** (parent agent picker), **Role**, **Job definition**, Goals, Constraints | 1, 2, 8 |
| 2. Model & Personality | Personality preset + 15 trait sliders (0–100) with a live "behavior preview" of the compiled directives; Model strategy (Fixed / Smart Router / Fallback Chain), provider connection, model, temperature, max output, context policy, fallback list; **Budgets** (daily $, per-task $, max tool calls, max runtime, on-exceed: Stop / Request Approval) | 3, 4, 9 |
| 3. MCP Tools | Search; list of connected MCP servers with tool counts; per-server tool checklist with "Select all" and "n/m selected" | 5 |
| 4. Permissions | Per-tool mode (Auto Allow / Approval Required / Blocked) with filter tabs (All / Auto Allow / Approval Required / Blocked); Approval Settings: "Require approval for high-risk actions" master toggle + high-risk category checklist (send emails, create calendar events, publish to social media, make payments, delete files, run external code) | 6 |
| 5. Review | Read-only summary of all steps with "Edit" links; optional **Knowledge** attach (files/URLs, agent scope) and memory policy (on/off, which layers); actions **Save as Draft** / **Create & Activate** | 7, 10 |

Rules:

-   Steps 1–2 are required. Steps 3–4 may be skipped (agent then has no
    tools).
-   Defaults on step 4: read-only tools → Auto Allow; tools matching a
    high-risk category → Approval Required; destructive tools (delete,
    drop, transfer) → Blocked. Users may make any tool stricter, and
    may loosen a tool only up to the workspace default (§8.1.1).
-   "Create & Activate" requires a valid model configuration (provider
    connection is healthy) — otherwise the agent is saved as Draft
    (`Configured` if all required fields are valid).
-   Wizard state is persisted as a Draft agent after step 1 so the user
    can leave and resume.

------------------------------------------------------------------------

# 20. Agent Detail Screen

**v1.2 layout** (from the approved visuals): a header, 6 visible tabs,
an optional right-hand panel, and a Settings drawer.

**Header (replaces the v1.1 Overview tab):** avatar, name, status badge
(Online / Working / Idle / Paused), current model, today's cost, actions
(pause/resume, settings gear, overflow).

**Visible tabs:**

``` text
Chat | Tasks | Tools | Files | Memory | Logs
```

| Tab | Contents | v1.1 tabs covered |
|-----|----------|-------------------|
| Chat | Conversation with the agent; rich output cards (e.g. script card with "View Script", "See Storyboard", "Generate Video"); inline tool-call chips; inline approval prompts; Approve / Reject / Revise / Feedback on outputs (§13). Right-hand **Available Tools** panel (searchable list of permitted tools). | Chat |
| Tasks | Tasks assigned to this agent, with counts; each task links to its runs. | Tasks, Runs |
| Tools | Assigned MCP tools and permission modes (editable, same UI as wizard step 4). | Tools |
| Files | Agent-scoped knowledge sources and generated artifacts. | Knowledge |
| Memory | Memory inspector for this agent (§12): search, edit, pin, disable, delete; filter by layer. | Memory |
| Logs | Runs, run events, tool calls, routing/fallback events, audit entries for this agent. | Logs, Runs |

**Settings drawer (gear icon)** contains sections:

``` text
Personality
Role & Instructions
AI Brain
Budgets
Performance
General (name, avatar, type, hierarchy, lifecycle: pause / archive)
```

No v1.1 capability is removed; the less frequently used configuration
moves into the drawer.

The `AI Brain` section contains:

-   model strategy
-   provider
-   model
-   router rules
-   fallback chain
-   model parameters
-   budgets
-   usage statistics

------------------------------------------------------------------------

# 21. Security Requirements

## Authentication

MVP may support:

-   email/password
-   local account

Architecture should permit OAuth/SSO later.

## Authorization

Server-side tenant validation is mandatory.

Frontend visibility is NOT authorization.

## Secrets

Encrypt:

-   API keys
-   OAuth tokens
-   MCP credentials
-   provider credentials

Never expose them to model context.

## Prompt Injection

External content is untrusted.

MCP/tool output MUST NOT be allowed to:

-   change system policy
-   grant permissions
-   alter approval rules
-   expose secrets
-   impersonate user authorization

All tool calls pass through server-side policy validation.

------------------------------------------------------------------------

# 22. Audit & Observability

Record:

-   agent creation/change
-   personality changes
-   model changes
-   model routing
-   fallback events
-   task delegation
-   MCP connection changes
-   tool calls
-   approval decisions
-   memory writes
-   workflow execution
-   cost
-   tokens
-   errors

Each run receives a unique `run_id`.

------------------------------------------------------------------------

# 23. Core Data Model

## users

``` text
id
email
display_name      (v1.2)
password_hash / auth_provider
locale            (v1.2: en | tr)
status
created_at
```

## workspaces

``` text
id
owner_user_id
name
settings
created_at
```

## agents

``` text
id
workspace_id
owner_user_id
parent_agent_id
agent_type
name
role
job_definition
goals
constraints
status
model_strategy
created_at
updated_at
```

## agent_personalities

``` text
agent_id
preset
trait_scores JSON
communication_rules
decision_rules
version
```

## provider_connections

``` text
id
workspace_id
provider
endpoint
secret_ref
status
metadata
```

## model_configs

``` text
id
agent_id
strategy
primary_provider_connection_id
primary_model
parameters JSON
budget_policy JSON
```

## model_routes

``` text
id
model_config_id
task_category
provider_connection_id
model
priority
conditions JSON
```

## model_fallbacks

``` text
id
model_config_id
provider_connection_id
model
priority
conditions JSON
```

## model_capabilities

``` text
provider
model
capabilities JSON
context_window
pricing_metadata
local_or_cloud
```

## mcp_connections

``` text
id
workspace_id
owner_user_id
name
server_type
transport
endpoint
auth_ref
status
capabilities
```

## mcp_tools

``` text
id
connection_id
external_tool_name
description
normalized_schema
enabled
```

## agent_tool_permissions

``` text
agent_id
mcp_tool_id
permission_mode
constraints JSON
```

## knowledge_sources

``` text
id
workspace_id
scope
agent_id
type
source_ref
metadata
indexing_status
```

## memories

``` text
id
workspace_id
agent_id
memory_type
content_or_ref
provenance
confidence
status
created_at
```

## tasks

``` text
id
workspace_id
agent_id
parent_task_id
objective
state
priority
budget
due_at
```

## runs

``` text
id
task_id
agent_id
provider
model
started_at
ended_at
status
token_usage
cost
```

## run_events

``` text
id
run_id
event_type
payload
timestamp
```

## tool_calls

``` text
id
run_id
agent_id
tool_id
arguments
permission_decision
result
error
```

## approval_requests

``` text
id
workspace_id
agent_id
tool_call_payload
risk
status
approver
requested_at
resolved_at
```

## workflows

``` text
id
workspace_id
name
version
graph_definition
active
```

## schedules

``` text
id
workspace_id
target_type
target_id
schedule_expression
timezone
active
```

## feedback_events

``` text
id
workspace_id
agent_id
run_or_output_ref
action
comment
memory_promotion_state
```

## audit_logs

``` text
id
workspace_id
actor_user_id
agent_id
action
target
outcome
timestamp
```

------------------------------------------------------------------------

# 24. Service Architecture

Recommended service boundaries:

### Auth / Tenant Service

-   authentication
-   sessions
-   workspace membership
-   tenant guards

### Agent Service

-   CRUD
-   hierarchy
-   personality configuration
-   lifecycle

### Model Gateway

-   provider adapters
-   model execution
-   Smart Router
-   fallback chains
-   capability validation
-   cost tracking

### Agent Runtime

-   runtime prompt assembly
-   task context
-   personality injection
-   memory retrieval
-   model invocation
-   structured output

### MCP Gateway

-   connections
-   authentication references
-   discovery
-   tool registry
-   execution
-   health checks

### Policy Engine

-   permissions
-   approvals
-   budgets
-   risk classification

### Memory Service

-   retrieval
-   writing
-   provenance
-   feedback promotion

### Task / Orchestration Service

-   queues
-   delegation
-   dependencies
-   retries
-   state

### Workflow Service

-   graph validation
-   graph execution
-   versions
-   schedules

### Approval Service

-   approval queue
-   decisions
-   parameter changes
-   execution continuation

### Observability Service

-   logs
-   runs
-   traces
-   tokens
-   costs
-   metrics

------------------------------------------------------------------------

# 25. Agent Runtime Assembly

For every agent execution, construct runtime context in this order:

``` text
1. Platform Safety Policy
2. Tenant/User Policy
3. Agent Permission Policy
4. Approval Policy
5. Agent Role
6. Job Definition
7. Goals & Constraints
8. Personality Runtime Directives
9. Relevant Procedural Memory
10. Relevant Semantic/Episodic Memory
11. Relevant Knowledge
12. Current Task
13. Available MCP Tools
14. Output Requirements
```

Do NOT dump the complete memory database into the prompt.

Retrieve only relevant context.

------------------------------------------------------------------------

# 26. Example Agent

``` yaml
name: Viral Aviation Director
type: Manager Agent

role:
  Own Pilots Quest short-form content production.

personality:
  analytical: 75
  creative: 95
  skeptical: 70
  assertive: 70
  cautious: 55
  concise: 80
  autonomous: 75
  collaborative: 90
  proactive: 90
  experimental: 80

model:
  strategy: SMART_ROUTER

routes:
  research: Research-Capable Model
  reasoning: High-Reasoning Model
  fast_tasks: Low-Cost Fast Model
  private_tasks: Local Ollama Model

fallback:
  - Secondary Cloud Model
  - Local Ollama Model

job:
  Research high-potential aviation topics, direct scripts and visual
  concepts, coordinate specialist agents, and produce approval-ready
  content packages.

permissions:
  research: AUTO_ALLOW
  knowledge_read: AUTO_ALLOW
  media_generation: AUTO_ALLOW
  publishing: APPROVAL_REQUIRED
  deletion: BLOCKED

reports_to:
  Master Orchestrator
```

------------------------------------------------------------------------

# 27. MVP Requirements

> v1.2: this list defines MVP-complete. It is delivered across releases
> v0.1–v0.6 per §34 and `ROADMAP.md`.

MUST ship:

-   multi-user authentication
-   strict tenant isolation
-   private user dashboard
-   agent CRUD
-   Master / Manager / Specialist agent types
-   reporting hierarchy
-   personality engine
-   personality presets
-   custom personality traits
-   per-agent model selection
-   Fixed Model strategy
-   Smart Router architecture
-   Fallback Chain
-   provider connection management
-   local Ollama support
-   MCP Hub
-   custom MCP connections
-   MCP tool discovery
-   per-agent tool permissions
-   task system
-   agent runtime
-   approval inbox
-   knowledge system
-   inspectable memory
-   feedback learning
-   basic multi-agent delegation
-   workflow builder
-   schedules
-   budgets
-   logs
-   token usage
-   cost analytics

------------------------------------------------------------------------

# 28. Acceptance Criteria

The product is not considered MVP-complete unless:

1.  A new user can register/login and sees only their own environment.
2.  User A cannot access User B's resources through API manipulation.
3.  A user can create multiple agents.
4.  Every agent can have a different personality.
5.  Personality changes produce different bounded runtime behavior.
6.  Every agent can independently choose a model/provider.
7.  One agent can use a cloud model while another uses local Ollama.
8.  Changing an agent's model does not erase personality, memory, role,
    or tools.
9.  Fixed Model execution works.
10. Smart Router records the selected model and routing reason.
11. Fallback Chain records fallback events.
12. Provider credentials never enter ordinary model prompts.
13. A user can connect an MCP server.
14. MCP tools are discovered and displayed.
15. MCP tools can be assigned individually to agents.
16. BLOCKED tools cannot execute.
17. APPROVAL_REQUIRED tools pause before execution.
18. Approval events are auditable.
19. Master Orchestrator can delegate to an authorized agent.
20. Parent agents do not automatically transfer permissions to child
    agents.
21. Users can inspect and delete memories.
22. Tool failures are never represented as successful actions.
23. Token and estimated cost usage are visible.
24. Budgets can stop or escalate execution.
25. Workflows can be saved, tested, versioned, and activated.
26. Important model/tool/memory/permission changes are logged.

------------------------------------------------------------------------

# 29. Technical Foundation (locked in v1.2)

**v1.2: locked stack.**

| Layer | Choice |
|-------|--------|
| Repo | pnpm workspaces monorepo |
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, next-intl, React Flow (workflows, v0.5) |
| API | Next.js route handlers / server actions, calling domain services in `packages/*`; Zod for all input/output schemas |
| Worker | Node.js process (`apps/worker`) consuming BullMQ queues: agent runs, tool execution, MCP health checks, ingestion, schedules |
| Database | PostgreSQL 16 + pgvector, Drizzle ORM + migrations |
| Queue | Redis + BullMQ |
| Artifacts | Object storage abstraction; local filesystem driver in v0.1, S3-compatible later |
| Knowledge / Memory | pgvector embeddings (embedding provider via Model Gateway) |
| Models | Provider adapters: OpenAI, Anthropic, Google, Ollama, OpenAI-compatible |
| MCP | Official MCP TypeScript SDK as client |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| Deployment | Docker Compose: `web`, `worker`, `postgres`, `redis`; Ollama runs on host (`host.docker.internal:11434`) or as an optional service |

Package layout:

``` text
apps/web            Next.js UI + API
apps/worker         BullMQ workers
packages/db         Drizzle schema, migrations, tenantScope()
packages/core       Domain services (agents, tasks, memory, audit)
packages/model-gateway   Provider adapters, router, fallback, cost
packages/mcp-gateway     MCP client, discovery, registry, execution
packages/policy     Permissions, approvals, budgets, risk classification
packages/ui         Design system components
packages/i18n       Message catalogs (en, tr)
```

Security implementation notes:

-   **Sessions:** server-side sessions in Postgres, httpOnly + Secure +
    SameSite=Lax cookies; passwords hashed with Argon2id.
-   **Tenant scoping:** all data access goes through a
    `tenantScope(ctx)` helper that injects `workspace_id` into every
    query; direct table access outside `packages/db` is disallowed by
    lint rule. Integration tests assert cross-tenant access returns
    404.
-   **Secrets:** AES-256-GCM envelope encryption; master key from
    `AGENTOS_MASTER_KEY` env var; tables store only `secret_ref`;
    decryption happens only inside the gateway call site.
-   **Logging:** structured logger with a redaction list (keys, tokens,
    `Authorization` headers).

## Critical rule

The following MUST remain server-side:

-   tenant authorization
-   orchestration
-   permission enforcement
-   approval enforcement
-   secrets
-   model credentials
-   MCP credentials
-   budget enforcement

------------------------------------------------------------------------

# 30. Build Phases

## Phase 1 --- Foundation

Build:

-   authentication
-   user/workspace isolation
-   database
-   dashboard shell
-   secret management
-   audit primitives

## Phase 2 --- Agent Core

Build:

-   agent CRUD
-   hierarchy
-   personality engine
-   provider connections
-   per-agent model configuration
-   model gateway
-   basic runtime

## Phase 3 --- MCP

Build:

-   MCP Hub
-   custom MCP connection
-   authentication lifecycle
-   tool discovery
-   tool registry
-   agent permissions

## Phase 4 --- Tasks & Approval

Build:

-   task queue
-   tool execution
-   approval inbox
-   budgets
-   execution logs

## Phase 5 --- Knowledge & Memory

Build:

-   knowledge ingestion
-   retrieval
-   memory layers
-   feedback
-   persistent learning controls

## Phase 6 --- Multi-Agent

Build:

-   delegation
-   Master Orchestrator
-   Manager behavior
-   inter-agent task handoff
-   result synthesis

## Phase 7 --- Workflows & Automation

Build:

-   visual workflow editor
-   graph execution
-   schedules
-   workflow versions

## Phase 8 --- Intelligence & Analytics

Build:

-   Smart Router policies
-   model fallback optimization
-   cost analytics
-   agent performance analytics
-   reliability hardening

------------------------------------------------------------------------

# 31. Locked Product Decisions

The following decisions are considered locked unless explicitly changed
by the product owner:

1.  AgentOS is multi-user from the beginning.
2.  Each user's data and agents are isolated.
3.  Personality is a real runtime behavioral layer.
4.  Personality does not grant permissions.
5.  Each agent can use a different AI model.
6.  Model configuration is independent from agent identity.
7.  AgentOS supports both cloud and local models.
8.  MCP is the primary integration abstraction.
9.  MCP credentials belong to the user/workspace, not individual agents.
10. MCP tools are granted per agent.
11. Master Orchestrator is an agent type, not a superuser.
12. High-risk external actions require permission/approval.
13. Agent learning is inspectable and controllable.
14. Training initially means knowledge + memory + feedback + SOP
    learning.
15. Fine-tuning is not required for MVP.
16. Important autonomous actions are auditable.
17. The architecture must remain provider-agnostic.

------------------------------------------------------------------------

# 32. Instructions to the Implementing Coding Agent

Treat this PRD as the product source of truth.

When implementing:

1.  Do not collapse the system into a single-agent chatbot.
2.  Do not implement personality as cosmetic profile text.
3.  Do not hard-code a single AI provider.
4.  Do not share model or MCP credentials between users without tenant
    ownership.
5.  Do not expose all MCP tools automatically after connection.
6.  Do not place authorization only in frontend code.
7.  Do not allow personality or prompts to bypass permissions.
8.  Do not allow orchestrators to become implicit superusers.
9.  Do not silently perform approval-required external actions.
10. Do not silently switch models without recording the reason.
11. Keep model selection independent per agent.
12. Keep the runtime modular so providers, tools, memory backends, and
    MCP servers can be added later.
13. Prefer typed schemas and structured events for agent/tool execution.
14. Persist execution state so tasks can be inspected and recovered.
15. Build tenant isolation and auditability before advanced autonomy.
16. If an implementation choice conflicts with security, tenant
    isolation, permissions, or auditability, choose the safer
    architecture.
17. Ask for a product decision instead of inventing behavior when a
    major unresolved requirement materially affects architecture.

The target is not merely a chatbot dashboard.

The target is a **multi-user operating system for persistent,
personality-driven, model-independent AI workforces connected to real
tools through MCP.**

------------------------------------------------------------------------

# 33. Internationalization (new in v1.2)

-   The UI ships in **English (`en`, default) and Turkish (`tr`)** from
    v0.1.
-   All UI strings live in message catalogs (`packages/i18n`); no
    hard-coded user-facing strings in components. CI fails on missing
    keys in either locale.
-   Locale is a per-user setting (Settings → Profile), initialized from
    the browser's `Accept-Language`.
-   Dates, times, numbers, and currency are formatted with the user's
    locale; schedules store an explicit IANA timezone.
-   **Agent output language** is not tied to the UI locale: an agent
    replies in the language of the conversation unless its job
    definition or constraints specify a language.
-   Personality presets, trait names, permission modes, and system
    status labels are translated; user-entered content (agent names,
    descriptions, memories) is never auto-translated.
-   Avoid layouts that break with longer Turkish strings (no fixed-width
    buttons for labels).

------------------------------------------------------------------------

# 34. Release Plan (new in v1.2)

§27 lists the full MVP. v1.2 delivers it in releases, starting with a
thin vertical slice that runs end to end. Detailed scope, acceptance
criteria mapping, and definitions of done are in `ROADMAP.md`.

| Release | Theme | Milestones / scope | §28 criteria |
|---------|-------|--------------------|--------------|
| **v0.1** | Thin vertical slice | M0 Scaffolding · M1 Foundation · M2 App shell + design system · M3 Agents + Personality · M4 Model Gateway · M5 MCP Hub · M6 Runtime + Chat + Approvals | 1–18, 22–24 |
| v0.2 | Tasks & Schedules | Task queue, Tasks screen, schedules | — (enables 24 at task level) |
| v0.3 | Knowledge & Memory | Ingestion, retrieval, memory layers, inspector, feedback learning | 21 |
| v0.4 | Multi-Agent | Master Orchestrator, delegation, synthesis | 19, 20 |
| v0.5 | Workflows | Workflow builder, execution, versions | 25 |
| v0.6 | Intelligence & Analytics | Advanced routing, analytics, hardening, stdio MCP | 26 (full) |

v0.1 definition: a new user can register, connect a model provider and a
remote MCP server, create an agent with a personality and model through
the wizard, assign tools with permissions, chat with the agent, see it
call tools, approve a risky tool call from the Approval Inbox, and
inspect the run, tokens, and cost in the logs.

The §27 list remains the definition of **MVP-complete** (end of v0.6).

------------------------------------------------------------------------

# 35. Design System (new in v1.2)

Derived from `AgentOS Dark-Mode AI Dashboard Collage.png`. Dark mode is
the default and the only theme required for v0.1; tokens must allow a
light theme later.

## 35.1 Color tokens (approximate; refine during M2)

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#0B0F1A` | App background |
| `surface` | `#121829` | Cards, sidebar |
| `surface-2` | `#1A2135` | Inputs, hovered rows |
| `border` | `#232B42` | Card and table borders |
| `text` | `#E6E9F2` | Primary text |
| `text-muted` | `#8A93AD` | Secondary text |
| `primary` | `#3B5BFF` | Primary buttons, active nav, toggles, selected step |
| `success` | `#22C55E` | Connected, Allowed, Success, Working |
| `warning` | `#F59E0B` | Approval Required, Idle |
| `danger` | `#EF4444` | Disconnect, Failed, Blocked |
| `info` | `#38BDF8` | Running, Scheduled |

Status badges are pill-shaped with a tinted background (~15% opacity)
and a colored dot or text.

## 35.2 Layout

-   Left sidebar, ~220px, logo "AgentOS" top-left, 12 nav items with
    icons (§3); active item uses `primary` background.
-   Top bar: global search ("Search agents, tasks, tools…") with `⌘K`
    command palette, notifications, help, settings, user avatar.
-   Page header: title, subtitle, primary action button top-right
    (e.g. `+ New Agent`, `+ Connect MCP Server`, `+ New Task`).
-   Content in cards with ~12px radius, 1px `border`, 16–24px padding.

## 35.3 Core components

KPI stat tile · agent card (avatar, name, role, status badge) · MCP
server card · data table with filter tabs and counts · permission
select (Auto Allow / Approval Required / Blocked) · toggle · stepper
(numbered circles, active = `primary`) · trait slider · chat message +
rich output card · approval card · bar chart (task overview) · workflow
node (icon, title, assigned agent).

## 35.4 Accessibility

WCAG AA contrast for text on `surface`; all interactive elements keyboard
reachable; status never conveyed by color alone (badge text required).
