import { cn } from './cn';

/** Initials avatar; image avatars arrive with agent profiles (M3). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase())
      .join('') || '?';
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary',
        className,
      )}
    >
      {initials}
    </span>
  );
}
