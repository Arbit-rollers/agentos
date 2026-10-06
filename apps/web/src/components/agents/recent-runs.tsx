import { getFormatter, getTranslations } from 'next-intl/server';
import type { Run, RunEvent } from '@agentos/db';
import { StatusBadge, type StatusTone } from '@agentos/ui';

const TONE: Record<Run['status'], StatusTone> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
};

type Target = { provider?: string; model?: string };
const name = (target: unknown) => {
  const t = (target ?? {}) as Target;
  return `${t.provider ?? '?'}/${t.model ?? '?'}`;
};

/** Runs with their routing, fallback and usage events (PRD §22; full Logs page in M6). */
export async function RecentRuns({ runs }: { runs: (Run & { events: RunEvent[] })[] }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const now = new Date();

  const reason = (payload: Record<string, unknown>) => {
    const r = payload.reason;
    if (typeof r === 'string') {
      return t.has(`runs.reasons.${r}` as never) ? t(`runs.reasons.${r}` as never) : r;
    }
    const routing = (r ?? {}) as { code?: string; category?: string };
    const category = routing.category ? t(`brain.categories.${routing.category as 'general'}`) : '';
    return t.has(`runs.reasons.${routing.code}` as never)
      ? t(`runs.reasons.${routing.code}` as never, { category } as never)
      : String(routing.code);
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
      case 'run.failed':
        return t('runs.events.failed', {
          reason: t.has(`errors.${String(p.code)}` as never)
            ? t(`errors.${String(p.code)}` as never)
            : String(p.code),
        });
      default:
        return event.type;
    }
  };

  if (runs.length === 0) return <p className="text-sm text-text-muted">{t('runs.noRuns')}</p>;

  return (
    <ul className="divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id} className="py-2">
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <StatusBadge tone={TONE[run.status]}>{t(`runs.status.${run.status}`)}</StatusBadge>
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
              <time
                className="ml-auto text-xs text-text-subtle"
                dateTime={run.startedAt.toISOString()}
              >
                {format.relativeTime(run.startedAt, now)}
              </time>
            </summary>
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
