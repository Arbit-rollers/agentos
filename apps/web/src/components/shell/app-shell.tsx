'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@agentos/ui';
import { CommandPalette } from './command-palette';
import type { NavKey } from './nav-items';
import { Logo, SidebarNav } from './sidebar-nav';
import { TopBar, type ShellUser, type ShellWorkspace } from './top-bar';

/** Sidebar + top bar frame for every signed-in page (PRD §35.2). */
export function AppShell({
  user,
  workspaces,
  badges = {},
  children,
}: {
  user: ShellUser;
  workspaces: ShellWorkspace[];
  /** Counts shown next to nav items, e.g. pending approvals. */
  badges?: Partial<Record<NavKey, number>>;
  children: ReactNode;
}) {
  const t = useTranslations('shell');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen lg:pl-56">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-surface lg:flex">
        <Logo />
        <SidebarNav badges={badges} />
      </aside>

      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent title={t('openNavigation')} hideTitle side="left">
          <Logo />
          <SidebarNav badges={badges} onNavigate={() => setNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <TopBar
        user={user}
        workspaces={workspaces}
        onOpenSearch={() => setPaletteOpen(true)}
        onOpenNavigation={() => setNavOpen(true)}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl p-4 outline-none lg:p-6">
        {children}
      </main>
    </div>
  );
}
