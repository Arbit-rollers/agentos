import type { ReactNode } from 'react';
import { logoutAction } from '@/app/(auth)/actions';
import { requireSession } from '@/server/session';

// Minimal frame until the full app shell lands in M2.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, workspace } = await requireSession();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">AgentOS</span>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
            {workspace.name}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-muted" data-testid="user-email">
            {user.email}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="rounded-lg border border-border px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
