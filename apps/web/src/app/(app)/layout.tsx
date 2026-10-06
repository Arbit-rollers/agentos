import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireSession } from '@/server/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  return (
    <AppShell user={{ displayName: user.displayName, email: user.email }}>{children}</AppShell>
  );
}
