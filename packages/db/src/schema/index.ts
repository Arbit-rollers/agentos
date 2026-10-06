// Tables are added milestone by milestone (see docs/ROADMAP.md).
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
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
    /** FK added when the agents table lands (M3). */
    agentId: uuid('agent_id'),
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
