import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { WorkflowRun, WorkflowRunStep } from '@agentos/db';
import { StatusBadge, type StatusTone } from '@agentos/ui';
import { AutoRefresh } from '@/components/auto-refresh';
import { CancelRunButton } from './run-actions';

export const RUN_TONE: Record<WorkflowRun['status'], StatusTone> = {
  queued: 'neutral',
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
const STEP_TONE: Record<WorkflowRunStep['status'], StatusTone> = {
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

/** Workflow runs and their step logs (PRD §16 "logs"). Refreshes while any is active. */
export async function WorkflowRunList({
  workflowId,
  runs,
  steps,
  openRunId,
  canCancel,
}: {
  workflowId: string;
  runs: (WorkflowRun & { version: number; triggeredByName: string })[];
  steps: WorkflowRunStep[];
  openRunId?: string;
  canCancel: (run: WorkflowRun) => boolean;
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  const active = runs.some((r) => ['queued', 'running', 'waiting'].includes(r.status));
  const text = (code: string | null) =>
    code ? (t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : code) : '';
  if (runs.length === 0) return <p className="text-sm text-text-muted">{t('workflows.noRuns')}</p>;
  return (
    <>
      <AutoRefresh active={active} />
      <ul className="space-y-2" aria-label={t('workflows.runs')}>
        {runs.map((run) => {
          const own = steps.filter((s) => s.runId === run.id);
          return (
            <li key={run.id} className="rounded-lg border border-border" data-run={run.id}>
              <details open={run.id === openRunId || runs[0]?.id === run.id}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <StatusBadge tone={RUN_TONE[run.status]}>
                    {t(`workflows.runStatus.${run.status}`)}
                  </StatusBadge>
                  <span>{t(`workflows.triggers.${run.trigger}`)}</span>
                  <span className="text-text-muted">
                    {t('workflows.version', { version: run.version })} · {run.triggeredByName} ·{' '}
                    {format.relativeTime(run.startedAt, new Date())}
                  </span>
                  {canCancel(run) && ['queued', 'running', 'waiting'].includes(run.status) && (
                    <span className="ml-auto">
                      <CancelRunButton workflowId={workflowId} runId={run.id} />
                    </span>
                  )}
                </summary>
                <div className="space-y-3 border-t border-border px-3 py-3">
                  {run.input && (
                    <p className="text-xs text-text-muted">
                      {t('workflows.input')}: <span className="text-text">{run.input}</span>
                    </p>
                  )}
                  <ol className="space-y-2" aria-label={t('workflows.steps')}>
                    {own.map((step) => (
                      <li key={step.id} className="text-sm" data-step-log={step.label}>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={STEP_TONE[step.status]}>
                            {t(`workflows.stepStatus.${step.status}`)}
                          </StatusBadge>
                          <span className="font-medium">{step.label}</span>
                          <span className="text-xs text-text-subtle">
                            {t(`workflows.types.${step.nodeType}`)}
                          </span>
                          {step.taskId && (
                            <Link
                              href={`/tasks/${step.taskId}`}
                              className="text-xs text-primary hover:underline"
                            >
                              {t('workflows.openTask')}
                            </Link>
                          )}
                          {step.approvalId && step.status === 'waiting' && (
                            <Link
                              href="/approvals"
                              className="text-xs text-primary hover:underline"
                            >
                              {t('workflows.openApprovals')}
                            </Link>
                          )}
                        </div>
                        {step.error && (
                          <p className="mt-1 text-xs text-danger">{text(step.error)}</p>
                        )}
                        {step.output && (
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface-2 p-2 text-xs whitespace-pre-wrap">
                            {step.output}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ol>
                  {run.output && (
                    <div>
                      <p className="text-xs font-medium">{t('workflows.output')}</p>
                      <pre
                        className="mt-1 rounded-lg bg-surface-2 p-2 text-xs whitespace-pre-wrap"
                        data-testid="run-output"
                      >
                        {run.output}
                      </pre>
                    </div>
                  )}
                  {run.error && <p className="text-sm text-danger">{text(run.error)}</p>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
