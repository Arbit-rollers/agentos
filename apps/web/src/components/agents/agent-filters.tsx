'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FilterTabs } from '@agentos/ui';
import { AGENT_FILTERS, type AgentFilter } from './filters';

export function AgentFilters({
  value,
  counts,
}: {
  value: AgentFilter;
  counts: Record<AgentFilter, number>;
}) {
  const t = useTranslations('agents.filters');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <FilterTabs
      label={t('all')}
      value={value}
      onValueChange={(next) =>
        router.replace(next === 'all' ? pathname : `${pathname}?status=${next}`)
      }
      tabs={AGENT_FILTERS.map((filter) => ({
        value: filter,
        label: t(filter),
        count: counts[filter],
      }))}
    />
  );
}
