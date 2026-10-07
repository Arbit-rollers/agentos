import type { ReactNode } from 'react';
import { listApprovalRequests } from '@agentos/db';
import { AppShell } from '@/components/shell/app-shell';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, ctx } = await requireSession();
  const pendingApprovals = (
    await listApprovalRequests(getServices().db, ctx, { status: 'pending' })
  ).length;
  return (
    <AppShell
      user={{ displayName: user.displayName, email: user.email }}
      badges={{ approvals: pendingApprovals }}
    >
      {children}
    </AppShell>
  );
}
