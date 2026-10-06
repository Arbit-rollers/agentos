'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { locales } from '@agentos/i18n';
import { cn } from '@agentos/ui';
import { setVisitorLocaleAction } from '@/app/(auth)/actions';

export function LocaleSwitcher() {
  const t = useTranslations('languages');
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1 text-sm" aria-busy={pending}>
      {locales.map((locale, index) => (
        <span key={locale} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-text-subtle">
              ·
            </span>
          )}
          <button
            type="button"
            lang={locale}
            aria-pressed={locale === current}
            onClick={() =>
              startTransition(async () => {
                await setVisitorLocaleAction(locale);
                router.refresh();
              })
            }
            className={cn(
              'rounded px-1.5 py-0.5',
              locale === current ? 'text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {t(locale)}
          </button>
        </span>
      ))}
    </div>
  );
}
