import type { ReactNode } from 'react';
import { cn } from './cn';

/** KPI tile: icon, value, label and an optional secondary line (PRD §35.3, Screen 1). */
export function StatTile({
  icon,
  label,
  value,
  detail,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-(--radius-card) border border-border bg-surface p-4',
        className,
      )}
    >
      <div
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary [&_svg]:size-5"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl leading-tight font-semibold">{value}</p>
        <p className="truncate text-sm text-text-muted">{label}</p>
        {detail && <p className="truncate text-xs text-text-subtle">{detail}</p>}
      </div>
    </div>
  );
}
