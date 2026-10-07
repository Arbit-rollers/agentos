'use client';

import { usePathname, useRouter } from 'next/navigation';
import { FilterTabs } from '@agentos/ui';

/** Filter tabs backed by a `?<param>=` query value (the first tab clears it). */
export function QueryTabs({
  param,
  value,
  label,
  tabs,
}: {
  param: string;
  value: string;
  label: string;
  tabs: { value: string; label: string; count?: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <FilterTabs
      label={label}
      value={value}
      onValueChange={(next) =>
        router.replace(next === tabs[0]?.value ? pathname : `${pathname}?${param}=${next}`)
      }
      tabs={tabs}
    />
  );
}
