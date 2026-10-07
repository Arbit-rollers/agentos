import type { ApprovalRequest } from '@agentos/db';
import type { ApprovalView } from './approval-card';

/** Serializable shape of an approval request for the client card. */
export function toApprovalView(a: ApprovalRequest & { agentName: string }): ApprovalView {
  return {
    id: a.id,
    kind: a.kind,
    agentId: a.agentId,
    agentName: a.agentName,
    status: a.status,
    risk: a.risk,
    reason: a.reason,
    payload: a.payload,
    estimatedCostUsd: a.estimatedCostUsd,
    requestedAt: a.requestedAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
  };
}
