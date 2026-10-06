'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FilterTabs } from '@agentos/ui';
import { HUB_TABS, type HubTab } from './hub-tabs';

export function HubFilters({ value, counts }: { value: HubTab; counts: Record<HubTab, number> }) {
  const t = useTranslations('mcp');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <FilterTabs
      label={t('filtersLabel')}
      value={value}
      onValueChange={(next) =>
        router.replace(next === 'all' ? pathname : `${pathname}?tab=${next}`)
      }
      tabs={HUB_TABS.map((tab) => ({ value: tab, label: t(`filters.${tab}`), count: counts[tab] }))}
    />
  );
}
