'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@agentos/ui';

const SECTIONS = [
  { href: '/settings', key: 'profileTab' },
  { href: '/settings/providers', key: 'providersTab' },
] as const;

export function SettingsNav() {
  const t = useTranslations('settings');
  const pathname = usePathname();
  return (
    <nav aria-label={t('sectionsLabel')} className="mb-6 flex gap-1 border-b border-border">
      {SECTIONS.map(({ href, key }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
