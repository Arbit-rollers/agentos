import { listApprovalRequests } from '@agentos/db';
import { withSession } from '@/server/api';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** Pending approvals in the caller's workspace (the sidebar badge polls this). */
export async function GET() {
  return withSession(async ({ ctx }) => {
    const pending = await listApprovalRequests(getServices().db, ctx, {
      status: 'pending',
      limit: 1000,
    });
    return Response.json({ pending: pending.length }, { headers: { 'cache-control': 'no-store' } });
  });
}
