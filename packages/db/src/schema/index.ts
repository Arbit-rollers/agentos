// Tables are added milestone by milestone (see docs/ROADMAP.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  numeric,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// M1: Foundation — users, workspaces, sessions, secrets, audit (PRD §2, §21, §22, §23)
// ---------------------------------------------------------------------------

export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member', 'viewer']);
export const auditOutcome = pgEnum('audit_outcome', ['success', 'failure', 'denied']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always stored lower-cased and trimmed. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull().default(''),
    passwordHash: text('password_hash'),
    authProvider: text('auth_provider').notNull().default('password'),
    locale: text('locale').notNull().default('en'),
    status: userStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('workspaces_owner_idx').on(t.ownerUserId)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only ever lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Envelope-encrypted secrets (PRD §21). Each row has its own data key (DEK), which is
 * wrapped by the master key. Other tables reference secrets only by id (`secret_ref`).
 */
export const secrets = pgTable(
  'secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** What the secret is for, e.g. `provider:openai`, `mcp:oauth_token`. Never the value. */
    kind: text('kind').notNull(),
    keyVersion: text('key_version').notNull(),
    wrappedDek: bytea('wrapped_dek').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('secrets_workspace_idx').on(t.workspaceId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only for events with no resolvable workspace (e.g. login with unknown email). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references((): AnyPgColumn => agents.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: auditOutcome('outcome').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// M3: Agents + personality (PRD §5, §6, §23)
// ---------------------------------------------------------------------------

export const agentType = pgEnum('agent_type', [
  'master_orchestrator',
  'manager',
  'specialist',
  'system',
]);
export const agentStatus = pgEnum('agent_status', [
  'draft',
  'configured',
  'active',
  'paused',
  'archived',
]);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** Reporting line (PRD §5.1). Same workspace, strictly higher-ranked type. */
    parentAgentId: uuid('parent_agent_id').references((): AnyPgColumn => agents.id, {
      onDelete: 'set null',
    }),
    agentType: agentType('agent_type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** `preset:<key>` for the built-in gallery; uploads arrive later. */
    avatar: text('avatar').notNull().default('preset:bot'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    role: text('role').notNull().default(''),
    jobDefinition: text('job_definition').notNull().default(''),
    goals: text('goals')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    constraints: text('constraints')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: agentStatus('status').notNull().default('draft'),
    /** PRD §10: which high-risk tool categories always need human approval. */
    approvalPolicy: jsonb('approval_policy')
      .$type<{ requireApprovalForHighRisk: boolean; categories: string[] }>()
      .notNull()
      .default(
        sql`'{"requireApprovalForHighRisk":true,"categories":["send_email","calendar_write","publish_social","payments","delete_files","run_code","change_permissions"]}'::jsonb`,
      ),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_workspace_status_idx').on(t.workspaceId, t.status),
    index('agents_parent_idx').on(t.parentAgentId),
  ],
);

export const agentPersonalities = pgTable('agent_personalities', {
  agentId: uuid('agent_id')
    .primaryKey()
    .references(() => agents.id, { onDelete: 'cascade' }),
  preset: text('preset').notNull(),
  traitScores: jsonb('trait_scores').$type<Record<string, number>>().notNull(),
  /** Incremented on every change; changes are audited with before/after scores (PRD §6.6). */
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// M4: Model gateway — provider connections, per-agent model config, runs (PRD §7, §22, §23)
// ---------------------------------------------------------------------------

export const providerKind = pgEnum('provider_kind', [
  'openai',
  'anthropic',
  'google',
  'ollama',
  'openai_compatible',
]);
export const connectionStatus = pgEnum('connection_status', ['connected', 'error', 'untested']);
export const modelStrategy = pgEnum('model_strategy', ['fixed', 'smart_router', 'fallback_chain']);
export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
]);

export type DiscoveredModelRow = {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** A workspace's AI provider account (PRD §7.4). Credentials live in `secrets`, never here. */
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: providerKind('provider').notNull(),
    name: text('name').notNull(),
    endpoint: text('endpoint'),
    secretId: uuid('secret_id').references(() => secrets.id, { onDelete: 'set null' }),
    status: connectionStatus('status').notNull().default('untested'),
    /** Models discovered from the provider's model list on the last successful test. */
    models: jsonb('models')
      .$type<DiscoveredModelRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('provider_connections_workspace_idx').on(t.workspaceId)],
);

export type ModelParameters = { temperature?: number; maxOutputTokens?: number };
export type BudgetPolicy = {
  dailyUsd?: number;
  perTaskUsd?: number;
  /** PRD §18 runtime limits per task. */
  maxToolCalls?: number;
  maxRuntimeSeconds?: number;
  onExceed: 'stop' | 'request_approval';
};

/** One per agent; independent of the agent's identity, personality and tools (PRD §7). */
export const modelConfigs = pgTable('model_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .unique()
    .references(() => agents.id, { onDelete: 'cascade' }),
  strategy: modelStrategy('strategy').notNull(),
  primaryConnectionId: uuid('primary_connection_id')
    .notNull()
    .references(() => providerConnections.id),
  primaryModel: text('primary_model').notNull(),
  parameters: jsonb('parameters')
    .$type<ModelParameters>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  budgetPolicy: jsonb('budget_policy')
    .$type<BudgetPolicy>()
    .notNull()
    .default(sql`'{"onExceed":"stop"}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelRoutes = pgTable('model_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelConfigId: uuid('model_config_id')
    .notNull()
    .references(() => modelConfigs.id, { onDelete: 'cascade' }),
  taskCategory: text('task_category').notNull(),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => providerConnections.id),
  model: text('model').notNull(),
  priority: integer('priority').notNull(),
});

export const modelFallbacks = pgTable('model_fallbacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelConfigId: uuid('model_config_id')
    .notNull()
    .references(() => modelConfigs.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => providerConnections.id),
  model: text('model').notNull(),
  priority: integer('priority').notNull(),
});

/** One execution (PRD §22: every run gets a run_id). Tasks link here from M6/v0.2. */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references((): AnyPgColumn => conversations.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    /** Resumable loop state: the provider-neutral transcript and counters (M6 runtime). */
    state: jsonb('state').$type<Record<string, unknown>>(),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    status: runStatus('status').notNull().default('running'),
    strategy: modelStrategy('strategy'),
    taskCategory: text('task_category'),
    provider: providerKind('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Estimated USD; null when the model's pricing is unknown. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_workspace_started_idx').on(t.workspaceId, t.startedAt),
    index('runs_agent_started_idx').on(t.agentId, t.startedAt),
  ],
);

/** Ordered, structured record of what happened in a run: routing, fallbacks, usage. */
export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('run_events_run_idx').on(t.runId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// M5: MCP Hub — connections, discovered tools, per-agent tool permissions (PRD §8, §9)
// ---------------------------------------------------------------------------

export const mcpTransport = pgEnum('mcp_transport', ['streamable_http', 'sse']);
export const mcpAuthType = pgEnum('mcp_auth_type', ['none', 'bearer', 'headers', 'oauth']);
export const mcpStatus = pgEnum('mcp_status', ['connected', 'error', 'needs_auth', 'untested']);
export const permissionMode = pgEnum('permission_mode', [
  'AUTO_ALLOW',
  'APPROVAL_REQUIRED',
  'BLOCKED',
]);

export type McpServerInfo = {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
};
export type McpResourceRow = { uri: string; name: string; description?: string; mimeType?: string };

/** A workspace's MCP server (PRD §8). Credentials and OAuth state live in `secrets`. */
export const mcpConnections = pgTable(
  'mcp_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** Catalog template key (e.g. `github`) or `custom`. */
    serverType: text('server_type').notNull().default('custom'),
    transport: mcpTransport('transport').notNull(),
    endpoint: text('endpoint').notNull(),
    authType: mcpAuthType('auth_type').notNull(),
    secretId: uuid('secret_id').references(() => secrets.id, { onDelete: 'set null' }),
    status: mcpStatus('status').notNull().default('untested'),
    enabled: boolean('enabled').notNull().default(true),
    serverInfo: jsonb('server_info').$type<McpServerInfo>(),
    resources: jsonb('resources')
      .$type<McpResourceRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** SHA-256 of the OAuth `state` while an authorization is in progress. */
    oauthStateHash: text('oauth_state_hash'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('mcp_connections_workspace_idx').on(t.workspaceId),
    uniqueIndex('mcp_connections_oauth_state_key').on(t.oauthStateHash),
  ],
);

export const mcpTools = pgTable(
  'mcp_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => mcpConnections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    description: text('description').notNull().default(''),
    /** JSON Schema as published by the server (PRD §8.3: normalized and stored). */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
    annotations: jsonb('annotations')
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    riskCategory: text('risk_category'),
    /** Workspace default; agents may only be the same or stricter (PRD §9). */
    defaultPermission: permissionMode('default_permission').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** False when the server stopped listing the tool; it can't run until it reappears. */
    available: boolean('available').notNull().default(true),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mcp_tools_connection_name_key').on(t.connectionId, t.name)],
);

export const agentToolPermissions = pgTable(
  'agent_tool_permissions',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => mcpTools.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    permissionMode: permissionMode('permission_mode').notNull(),
    /** Future constraints (PRD §9): read-only, allowed folders/domains, rate limits… */
    constraints: jsonb('constraints')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.toolId] }),
    index('agent_tool_permissions_tool_idx').on(t.toolId),
  ],
);

// ---------------------------------------------------------------------------
// M6: Runtime — conversations, tasks, tool calls, approvals (PRD §10, §14, §20, §22)
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_agent_idx').on(t.agentId, t.updatedAt)],
);

export const messageRole = pgEnum('message_role', ['user', 'assistant']);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    /** The run that answered (assistant) or was started by (user) this message. */
    runId: uuid('run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const taskState = pgEnum('task_state', [
  'draft',
  'queued',
  'running',
  'waiting_for_agent',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
]);

/** PRD §14. Chat turns create tasks too, so every piece of agent work has a state. */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null',
    }),
    origin: text('origin').notNull(),
    objective: text('objective').notNull(),
    state: taskState('state').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),
    budget: jsonb('budget').$type<Record<string, unknown>>(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_workspace_state_idx').on(t.workspaceId, t.state),
    index('tasks_agent_created_idx').on(t.agentId, t.createdAt),
  ],
);

export const toolCallStatus = pgEnum('tool_call_status', [
  'approval_required',
  'approved',
  'rejected',
  'blocked',
  'succeeded',
  'failed',
]);

/** Every tool call an agent attempted, with the policy decision and outcome (PRD §22). */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id').references(() => mcpTools.id, { onDelete: 'set null' }),
    /** Snapshot: the tool may later be renamed or removed. */
    toolName: text('tool_name').notNull(),
    connectionName: text('connection_name'),
    providerCallId: text('provider_call_id').notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>(),
    status: toolCallStatus('status').notNull(),
    decisionReason: text('decision_reason'),
    /** Tool output (truncated) or an error code; untrusted content. */
    result: text('result'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('tool_calls_run_idx').on(t.runId, t.createdAt)],
);

export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

/** Human-in-the-loop decisions (PRD §10). A run waits until each of its requests is decided. */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    toolCallId: uuid('tool_call_id').references(() => toolCalls.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Tool name, server, arguments; or the budget that was hit. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    risk: text('risk').notNull(),
    reason: text('reason').notNull(),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    status: approvalStatus('status').notNull().default('pending'),
    approverUserId: uuid('approver_user_id').references(() => users.id),
    editedArguments: jsonb('edited_arguments').$type<Record<string, unknown>>(),
    note: text('note'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('approval_requests_workspace_status_idx').on(t.workspaceId, t.status),
    index('approval_requests_run_idx').on(t.runId),
  ],
);
