import { insertAuditLog, type Executor, type NewAuditLog } from '@agentos/db';
import { redact } from './redact';

export type AuditEntry = Omit<NewAuditLog, 'metadata'> & { metadata?: Record<string, unknown> };

/** Appends an audit event (PRD §22). Metadata is redacted before it is stored. */
export async function recordAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await insertAuditLog(db, {
    ...entry,
    metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
  });
}
