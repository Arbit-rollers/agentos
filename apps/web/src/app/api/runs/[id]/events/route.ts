import { findRun, listRunEventsAfter } from '@agentos/db';
import { isUuid, notFound, withSession } from '@/server/api';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

const POLL_MS = 400;
const MAX_MS = 5 * 60 * 1000;
const SETTLED = new Set(['completed', 'failed', 'cancelled', 'waiting_approval']);

/**
 * Live run updates for the chat (server-sent events). Streams new run events and the run's
 * status until it settles (finished, failed or waiting for approval). Workspace-scoped like
 * every other read: another tenant's run id answers 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withSession(async ({ ctx }) => {
    if (!isUuid(id)) return notFound();
    const db = getServices().db;
    if (!(await findRun(db, ctx, id))) return notFound();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        let after: Date | null = null;
        const started = Date.now();
        try {
          while (!request.signal.aborted && Date.now() - started < MAX_MS) {
            const run = await findRun(db, ctx, id);
            if (!run) break;
            const events = await listRunEventsAfter(db, ctx, id, after);
            if (events.length > 0) after = events.at(-1)!.createdAt;
            send('update', {
              status: run.status,
              error: run.error,
              events: events.map((e) => ({ type: e.type, payload: e.payload })),
            });
            if (SETTLED.has(run.status)) {
              send('done', { status: run.status });
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  });
}
