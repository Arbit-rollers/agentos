'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FilterTabs, Input } from '@agentos/ui';
import { MEMORY_FILTERS, type MemoryFilter } from './filters';

/** Type tabs and keyword search, kept in the URL so the server does the filtering. */
export function MemoryFilters({ counts }: { counts: Record<MemoryFilter, number> }) {
  const t = useTranslations('memoryPage');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get('type') as MemoryFilter | null) ?? 'all';
  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <FilterTabs
        label={t('type')}
        value={MEMORY_FILTERS.includes(current) ? current : 'all'}
        onValueChange={(type) => go({ type })}
        tabs={MEMORY_FILTERS.map((value) => ({
          value,
          label: t(`filters.${value}`),
          count: counts[value],
        }))}
      />
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: String(new FormData(event.currentTarget).get('q') ?? '') });
        }}
        className="relative w-full sm:w-64"
      >
        <Search
          className="pointer-events-none absolute top-2.5 left-3 size-4 text-text-subtle"
          aria-hidden
        />
        <Input
          name="q"
          defaultValue={params.get('q') ?? ''}
          placeholder={t('search')}
          aria-label={t('search')}
          className="pl-9"
        />
      </form>
    </div>
  );
}
