import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <p className="text-lg font-semibold tracking-tight">AgentOS</p>
      <div className="w-full max-w-sm rounded-(--radius-card) border border-border bg-surface p-6">
        {children}
      </div>
      <LocaleSwitcher />
    </main>
  );
}
