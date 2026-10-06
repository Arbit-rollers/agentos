import { Check } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from './cn';

type LinkComponent = ComponentType<{ href: string; className?: string; children: ReactNode }>;

/**
 * Numbered wizard steps (Screens 4–6). `current` is zero-based. Pass `hrefs` (and the app's
 * link component) to make steps navigable; steps without an href render as plain text.
 */
export function Stepper({
  steps,
  current,
  label,
  hrefs,
  linkAs: LinkAs,
}: {
  steps: string[];
  current: number;
  label: string;
  hrefs?: (string | undefined)[];
  linkAs?: LinkComponent;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        const content = (
          <>
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                state === 'current' && 'border-primary bg-primary text-primary-fg',
                state === 'done' && 'border-primary/60 bg-primary/15 text-primary',
                state === 'upcoming' && 'border-border-strong text-text-muted',
              )}
            >
              {state === 'done' ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('text-sm', state === 'upcoming' ? 'text-text-muted' : 'text-text')}>
              {step}
            </span>
          </>
        );
        const href = hrefs?.[index];
        return (
          <li
            key={step}
            className="flex items-center gap-2"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {href && LinkAs && state !== 'current' ? (
              <LinkAs href={href} className="flex items-center gap-2 rounded-md hover:opacity-80">
                {content}
              </LinkAs>
            ) : (
              <span className="flex items-center gap-2">{content}</span>
            )}
            {index < steps.length - 1 && (
              <span aria-hidden className="mx-1 h-px w-6 bg-border-strong sm:w-8" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
