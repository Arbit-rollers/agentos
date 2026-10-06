import { Plug } from 'lucide-react';
import { cn } from '@agentos/ui';
import { templateFor } from './templates';

/** Initials tile for catalog servers, a plug icon for custom ones. */
export function ServerIcon({
  serverType,
  size = 'md',
}: {
  serverType: string;
  size?: 'md' | 'lg';
}) {
  const template = templateFor(serverType);
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-lg text-sm font-bold text-white',
        size === 'lg' ? 'size-14 text-lg' : 'size-10',
      )}
      style={{ background: template?.color ?? 'var(--color-surface-3)' }}
    >
      {template ? template.initials : <Plug className="size-5 text-text-muted" />}
    </span>
  );
}
