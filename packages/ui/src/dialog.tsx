'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Modal panel. `title` is required for screen readers; hide it visually with `hideTitle`. */
export function DialogContent({
  title,
  hideTitle,
  className,
  children,
  side,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  hideTitle?: boolean;
  /** `left`/`right` render a full-height sheet (mobile navigation, settings drawer). */
  side?: 'center' | 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed z-50 border border-border bg-surface shadow-2xl outline-none',
          side === 'left'
            ? 'inset-y-0 left-0 w-72 border-y-0 border-l-0'
            : side === 'right'
              ? 'inset-y-0 right-0 w-full max-w-3xl overflow-y-auto border-y-0 border-r-0'
              : 'top-[15vh] left-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-(--radius-card)',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title
          className={hideTitle ? 'sr-only' : 'px-5 pt-4 text-base font-semibold'}
        >
          {title}
        </DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
