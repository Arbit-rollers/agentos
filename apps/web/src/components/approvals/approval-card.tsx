'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button, StatusBadge, Textarea } from '@agentos/ui';
import { decideApprovalAction } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';

export type ApprovalView = {
  id: string;
  kind: string;
  /** Null for workflow approvals (agentName then holds the workflow's name). */
  agentId: string | null;
  agentName: string;
  status: 'pending' | 'approved' | 'rejected';
  risk: string;
  reason: string;
  payload: Record<string, unknown>;
  estimatedCostUsd: number | null;
  requestedAt: string;
  resolvedAt: string | null;
};

/** One approval request with Approve once / Reject / Edit & approve (PRD §10). */
export function ApprovalCard({
  approval,
  compact = false,
  canDecide = true,
}: {
  approval: ApprovalView;
  compact?: boolean;
  /** The person the run works for, or an owner/admin. Others only see the request. */
  canDecide?: boolean;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(JSON.stringify(approval.payload.arguments ?? {}, null, 2));
  const [error, setError] = useState<string>();
  const isTool = approval.kind === 'tool_call' || approval.kind === 'workflow_tool';
  const isStep = approval.kind === 'workflow_approval';
  const budgetKind = String(approval.payload.kind ?? '');

  const decide = (decision: 'approve' | 'reject', editedArguments?: Record<string, unknown>) =>
    start(async () => {
      const result = await decideApprovalAction({
        approvalId: approval.id,
        decision,
        ...(editedArguments && { editedArguments }),
      });
      setError(result.error);
      if (!result.error) router.refresh();
    });

  const approveEdited = () => {
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      decide('approve', parsed as Record<string, unknown>);
    } catch {
      setError('invalidJson');
    }
  };

  const riskLabel = t.has(`riskCategories.${approval.risk}` as never)
    ? t(`riskCategories.${approval.risk}` as never)
    : approval.risk;

  return (
    <article
      className="rounded-(--radius-card) border border-warning/40 bg-warning/5 p-4"
      aria-label={t('workspace.approvalTitle')}
      data-approval={approval.id}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ShieldAlert aria-hidden className="size-4 text-warning" />
        <p className="font-medium">
          {isTool
            ? String(approval.payload.tool)
            : isStep
              ? String(approval.payload.step ?? '')
              : t('approvals.budget')}
        </p>
        <StatusBadge tone="warning">{riskLabel}</StatusBadge>
        {approval.status !== 'pending' && (
          <StatusBadge tone={approval.status === 'approved' ? 'success' : 'danger'}>
            {t(`approvals.status.${approval.status}`)}
          </StatusBadge>
        )}
        <span className="ml-auto text-xs text-text-subtle">
          {t('approvals.requested', {
            time: format.relativeTime(new Date(approval.requestedAt), new Date()),
          })}
        </span>
      </div>
      <dl className="mb-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
        {!compact && (
          <>
            <dt className="text-text-muted">
              {approval.agentId ? t('approvals.agent') : t('approvals.workflow')}
            </dt>
            <dd>
              {approval.agentId ? (
                <Link href={`/agents/${approval.agentId}`} className="hover:text-primary">
                  {approval.agentName}
                </Link>
              ) : (
                approval.agentName
              )}
            </dd>
          </>
        )}
        {isTool ? (
          <>
            <dt className="text-text-muted">{t('approvals.server')}</dt>
            <dd>{String(approval.payload.server ?? '—')}</dd>
            <dt className="text-text-muted">{t('approvals.reason')}</dt>
            <dd>
              {t.has(`errors.${approval.reason}` as never)
                ? t(`errors.${approval.reason}` as never)
                : approval.reason}
            </dd>
            <dt className="text-text-muted">{t('approvals.parameters')}</dt>
            <dd>
              {editing ? (
                <Textarea
                  aria-label={t('approvals.parameters')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              ) : (
                <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-xs">
                  {JSON.stringify(approval.payload.arguments ?? {}, null, 2)}
                </pre>
              )}
            </dd>
          </>
        ) : isStep ? (
          <>
            <dt className="text-text-muted">{t('approvals.message')}</dt>
            <dd className="whitespace-pre-wrap">{String(approval.payload.message ?? '')}</dd>
          </>
        ) : (
          <>
            <dt className="text-text-muted">{t('approvals.reason')}</dt>
            <dd>
              {t.has(`approvals.budgetKinds.${budgetKind}` as never)
                ? t(
                    `approvals.budgetKinds.${budgetKind}` as never,
                    {
                      value: String(approval.payload.value),
                      limit: String(approval.payload.limit),
                    } as never,
                  )
                : budgetKind}
            </dd>
          </>
        )}
        {approval.estimatedCostUsd !== null && (
          <>
            <dt className="text-text-muted">{t('approvals.estimatedCost')}</dt>
            <dd>
              {format.number(approval.estimatedCostUsd, { style: 'currency', currency: 'USD' })}
            </dd>
          </>
        )}
      </dl>
      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error === 'invalidJson' ? t('approvals.invalidJson') : errorText(error)}
        </p>
      )}
      {approval.status === 'pending' && !canDecide && (
        <p className="text-xs text-text-muted" data-testid="not-yours">
          {t('approvals.notYours')}
        </p>
      )}
      {approval.status === 'pending' && canDecide && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={pending} onClick={approveEdited}>
                {t('approvals.saveEdited')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                {t('approvals.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={pending} onClick={() => decide('approve')}>
                {isTool || isStep ? t('approvals.approve') : t('approvals.continue')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => decide('reject')}
              >
                {t('approvals.reject')}
              </Button>
              {isTool && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setEditing(true)}
                >
                  {t('approvals.edit')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
