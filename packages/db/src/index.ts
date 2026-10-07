// Public surface of the data layer. Tables and the query builder stay private to this
// package so every query goes through a repository (and tenantScope where it applies).
export { createDb, pingDb, withTransaction } from './client';
export type { Database, Executor, SqlClient, Transaction } from './client';
export type { TenantContext } from './tenant';
export * from './repos/users';
export * from './repos/workspaces';
export * from './repos/sessions';
export * from './repos/secrets';
export * from './repos/audit';
export * from './repos/agents';
export * from './repos/providers';
export * from './repos/model-configs';
export * from './repos/runs';
export * from './repos/mcp';
export * from './repos/runtime';
export * from './repos/schedules';
export * from './repos/knowledge';
export * from './repos/memories';
export * from './repos/feedback';
export { EMBEDDING_DIMENSIONS as DB_EMBEDDING_DIMENSIONS } from './schema/index';
