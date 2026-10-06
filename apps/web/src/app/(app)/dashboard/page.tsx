import { listAuditLogs } from '@agentos/db';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export default async function DashboardPage() {
  const { ctx } = await requireSession();
  const events = await listAuditLogs(getServices().db, ctx, { limit: 20 });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-text-muted">The full dashboard arrives in M2. Recent activity:</p>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {events.map((event) => (
          <li key={event.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-mono">{event.action}</span>
            <span className="flex items-center gap-3">
              <span
                className={
                  event.outcome === 'success'
                    ? 'rounded-full bg-success/15 px-2 py-0.5 text-success'
                    : 'rounded-full bg-danger/15 px-2 py-0.5 text-danger'
                }
              >
                {event.outcome}
              </span>
              <time className="text-text-muted" dateTime={event.createdAt.toISOString()}>
                {event.createdAt.toLocaleString('en')}
              </time>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
