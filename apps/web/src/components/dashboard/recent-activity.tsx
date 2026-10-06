import { getFormatter, getTranslations } from 'next-intl/server';
import type { DashboardSummary } from '@agentos/core';
import { StatusBadge, type StatusTone } from '@agentos/ui';

const OUTCOME_TONE: Record<string, StatusTone> = {
  success: 'success',
  failure: 'danger',
  denied: 'warning',
};

export async function RecentActivity({ events }: { events: DashboardSummary['recentActivity'] }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const now = new Date();

  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">{t('dashboard.activityEmpty')}</p>
    );
  }

  // Outcome-specific wording first ("Failed sign-in attempt"), then the action, then the raw id.
  // Catalog keys use "_" because next-intl reads "." as nesting: auth.login → auth_login.
  const describe = (action: string, outcome: string) => {
    const key = action.replaceAll('.', '_');
    const specific = `activity.${key}_${outcome}`;
    const general = `activity.${key}`;
    if (t.has(specific as never)) return t(specific as never);
    if (t.has(general as never)) return t(general as never);
    return t('activity.unknown', { action });
  };

  return (
    <ul className="divide-y divide-border">
      {events.map((event) => (
        <li key={event.id} className="flex items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate">{describe(event.action, event.outcome)}</p>
            <time dateTime={event.createdAt.toISOString()} className="text-xs text-text-muted">
              {format.relativeTime(event.createdAt, now)}
            </time>
          </div>
          <StatusBadge tone={OUTCOME_TONE[event.outcome] ?? 'neutral'}>
            {t(`outcome.${event.outcome}`)}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}
