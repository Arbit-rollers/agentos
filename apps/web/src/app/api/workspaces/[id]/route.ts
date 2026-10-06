import { getWorkspace } from '@agentos/db';
import { isUuid, notFound, withSession } from '@/server/api';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withSession(async ({ ctx }) => {
    if (!isUuid(id)) return notFound();
    const workspace = await getWorkspace(getServices().db, ctx, id);
    if (!workspace) return notFound();
    return Response.json({ id: workspace.id, name: workspace.name });
  });
}
