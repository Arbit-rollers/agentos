import { Check } from 'lucide-react';
import { cn } from './cn';

/** Numbered wizard steps (Screens 4–6). `current` is zero-based. */
export function Stepper({
  steps,
  current,
  label,
}: {
  steps: string[];
  current: number;
  label: string;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li
            key={step}
            className="flex items-center gap-2"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full border text-xs font-semibold',
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
            {index < steps.length - 1 && (
              <span aria-hidden className="mx-1 h-px w-8 bg-border-strong" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
