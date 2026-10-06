'use client';

import { Tabs } from 'radix-ui';
import { cn } from './cn';

export type FilterTab<T extends string> = { value: T; label: string; count?: number };

/** Row of filter tabs with optional counts, e.g. "All (12) · Connected (8)" (Screens 2, 8). */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
}: {
  tabs: FilterTab<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(next) => onValueChange(next as T)}>
      <Tabs.List aria-label={label} className="flex flex-wrap gap-1">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              'rounded-lg border border-transparent px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text',
              'data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-text',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-text-subtle">({tab.count})</span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
