import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { RunEvent, RunWithDetails } from '@agentos/db';
import { StatusBadge, type StatusTone } from '@agentos/ui';

export const RUN_TONE: Record<RunWithDetails['status'], StatusTone> = {
  queued: 'neutral',
  running: 'info',
  waiting_approval: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const TOOL_TONE: Record<string, StatusTone> = {
  succeeded: 'success',
  approved: 'info',
  approval_required: 'warning',
  rejected: 'danger',
  blocked: 'danger',
  failed: 'danger',
};

type Target = { provider?: string; model?: string };
const name = (target: unknown) => {
  const t = (target ?? {}) as Target;
  return `${t.provider ?? '?'}/${t.model ?? '?'}`;
};

/**
 * Runs with their model routing, tool calls and decisions (PRD §22). Used by the agent
 * workspace Logs tab and the Logs page.
 */
export async function RunLog({
  runs,
  showAgent = false,
}: {
  runs: RunWithDetails[];
  showAgent?: boolean;
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  const now = new Date();

  const translate = (key: string, fallback: string, values?: Record<string, string>) =>
    t.has(key as never) ? t(key as never, values as never) : fallback;

  const reason = (payload: Record<string, unknown>) => {
    const r = payload.reason;
    if (typeof r === 'string') return translate(`runs.reasons.${r}`, r);
    const routing = (r ?? {}) as { code?: string; category?: string };
    const category = routing.category
      ? translate(`brain.categories.${routing.category}`, routing.category)
      : '';
    return translate(`runs.reasons.${routing.code}`, String(routing.code), { category });
  };

  const describe = (event: RunEvent) => {
    const p = event.payload;
    switch (event.type) {
      case 'model.selected':
        return t('runs.events.selected', { target: name(p.target), reason: reason(p) });
      case 'model.skipped':
        return t('runs.events.skipped', { target: name(p.target), reason: reason(p) });
      case 'model.fallback':
        return t('runs.events.fallback', { target: name(p.from), reason: String(p.reason) });
      case 'model.provider_fallback': {
        const fb = (p.fallback ?? {}) as { from?: string; to?: string };
        return t('runs.events.provider_fallback', { from: fb.from ?? '?', to: fb.to ?? '?' });
      }
      case 'model.completed':
        return t('runs.events.completed', { target: name(p.target) });
      case 'tool.call':
        return t('runs.events.tool_call', {
          tool: String(p.tool),
          decision: translate(`errors.${String(p.reason)}`, String(p.decision)),
        });
      case 'tool.result':
        return t('runs.events.tool_result', {
          tool: String(p.tool),
          outcome: p.isError ? t('runs.events.outcomeError') : t('runs.events.outcomeOk'),
        });
      case 'approval.requested':
        return t('runs.events.approval_requested');
      case 'approval.decided':
        return t('runs.events.approval_decided', {
          decision: translate(`approvals.status.${String(p.decision)}`, String(p.decision)),
        });
      case 'budget.exceeded':
        return t('runs.events.budget_exceeded', {
          kind: translate(`errors.budget_${String(p.kind)}`, String(p.kind)),
        });
      case 'run.recovered':
        return t('runs.events.run_recovered', { repairedCalls: String(p.repairedCalls ?? 0) });
      case 'run.completed':
        return t('runs.events.run_completed');
      case 'run.failed':
        return t('runs.events.failed', {
          reason: translate(`errors.${String(p.code)}`, String(p.code)),
        });
      default:
        return event.type;
    }
  };

  if (runs.length === 0) return <p className="text-sm text-text-muted">{t('logs.empty')}</p>;

  return (
    <ul className="divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id} className="py-2" data-run={run.id}>
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <StatusBadge tone={RUN_TONE[run.status]}>
                {t(`runs.status.${run.status}`)}
              </StatusBadge>
              {showAgent && (
                <Link
                  href={`/agents/${run.agentId}?tab=logs`}
                  className="font-medium hover:text-primary"
                >
                  {run.agentName}
                </Link>
              )}
              <span className="font-mono text-xs">
                {run.model ? `${run.provider}/${run.model}` : '—'}
              </span>
              <span className="text-text-muted">
                {t('runs.tokens', {
                  input: format.number(run.inputTokens),
                  output: format.number(run.outputTokens),
                })}
              </span>
              <span className="text-text-muted">
                {run.costUsd === null
                  ? t('runs.costUnknown')
                  : t('runs.cost', {
                      cost: format.number(run.costUsd, { maximumFractionDigits: 4 }),
                    })}
              </span>
              {run.toolCalls.length > 0 && (
                <span className="text-text-muted">
                  {t('logs.toolCalls')}: {run.toolCalls.length}
                </span>
              )}
              <time
                className="ml-auto text-xs text-text-subtle"
                dateTime={run.startedAt.toISOString()}
              >
                {format.relativeTime(run.startedAt, now)}
              </time>
            </summary>
            {run.toolCalls.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {run.toolCalls.map((call) => (
                  <li key={call.id}>
                    <StatusBadge tone={TOOL_TONE[call.status] ?? 'neutral'}>
                      <span className="font-mono">{call.toolName}</span> ·{' '}
                      {t(`workspace.toolStatus.${call.status}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
            <ol className="mt-2 space-y-1 border-l border-border pl-4 text-sm text-text-muted">
              {run.events.map((event) => (
                <li key={event.id} data-event={event.type}>
                  {describe(event)}
                </li>
              ))}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}
