'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@agentos/ui';
import { NAV_ITEMS, isActive } from './nav-items';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')} className="flex flex-col gap-0.5 p-3">
      {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary text-primary-fg'
                : 'text-text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function Logo() {
  return (
    <Link
      href="/dashboard"
      className="flex h-14 items-center px-6 text-lg font-semibold tracking-tight"
    >
      AgentOS
    </Link>
  );
}
