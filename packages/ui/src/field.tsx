import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const inputClassName =
  'h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none placeholder:text-text-subtle focus:border-primary disabled:opacity-60 aria-invalid:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClassName, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(inputClassName, 'h-auto min-h-20 resize-y py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

/** Label + control + hint/error. Pass the control's id as `htmlFor`. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="text-xs text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
