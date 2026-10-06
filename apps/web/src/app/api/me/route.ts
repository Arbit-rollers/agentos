import { withSession } from '@/server/api';

export const dynamic = 'force-dynamic';

export function GET() {
  return withSession(async ({ user, workspace, role }) => Response.json({ user, workspace, role }));
}
