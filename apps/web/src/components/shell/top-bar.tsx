'use client';

import { Bell, LogOut, Menu as MenuIcon, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Avatar,
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@agentos/ui';
import { logoutAction } from '@/app/(auth)/actions';

export type ShellUser = { displayName: string; email: string };

export function TopBar({
  user,
  onOpenSearch,
  onOpenNavigation,
}: {
  user: ShellUser;
  onOpenSearch: () => void;
  onOpenNavigation: () => void;
}) {
  const t = useTranslations();
  const name = user.displayName || user.email;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t('shell.openNavigation')}
        onClick={onOpenNavigation}
      >
        <MenuIcon />
      </Button>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-subtle hover:border-border-strong"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 truncate text-left">{t('shell.search')}</span>
        <kbd className="hidden rounded border border-border-strong px-1.5 text-xs sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('shell.notifications')}>
              <Bell />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel className="text-text-muted">{t('shell.noNotifications')}</MenuLabel>
          </MenuContent>
        </Menu>

        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings" aria-label={t('nav.settings')}>
            <Settings />
          </Link>
        </Button>

        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={t('shell.accountMenu')} className="ml-1 rounded-full">
              <Avatar name={name} />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>
              <p className="font-medium">{name}</p>
              <p className="text-xs text-text-muted" data-testid="user-email">
                {user.email}
              </p>
            </MenuLabel>
            <MenuSeparator />
            <MenuItem asChild>
              <Link href="/settings">
                <Settings />
                {t('nav.settings')}
              </Link>
            </MenuItem>
            <MenuItem onSelect={() => void logoutAction()}>
              <LogOut />
              {t('shell.signOut')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
