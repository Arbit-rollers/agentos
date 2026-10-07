import type { ReactNode } from 'react';
import { findUserById, listApprovalRequests, listWorkspacesForUser } from '@agentos/db';
import { AppShell } from '@/components/shell/app-shell';
import { TimezoneSync } from '@/components/timezone-sync';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, ctx } = await requireSession();
  const db = getServices().db;
  const [pending, profile, workspaces] = await Promise.all([
    listApprovalRequests(db, ctx, { status: 'pending' }),
    findUserById(db, ctx.userId),
    listWorkspacesForUser(db, ctx.userId),
  ]);
  const pendingApprovals = pending.length;
  return (
    <AppShell
      user={{ displayName: user.displayName, email: user.email }}
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        current: w.id === ctx.workspaceId,
      }))}
      badges={{ approvals: pendingApprovals }}
    >
      {!profile?.timezone && <TimezoneSync />}
      {children}
    </AppShell>
  );
}
