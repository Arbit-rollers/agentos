// Tables are added milestone by milestone (see docs/ROADMAP.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
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
