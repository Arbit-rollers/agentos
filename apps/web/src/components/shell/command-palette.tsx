'use client';

import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Dialog, DialogContent } from '@agentos/ui';
import { NAV_ITEMS } from './nav-items';

/** ⌘K / Ctrl+K palette. Navigation only in v0.1; actions and search come later. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('command.title')} hideTitle className="overflow-hidden p-0">
        <Command label={t('command.title')} className="text-sm">
          <Command.Input
            autoFocus
            placeholder={t('command.placeholder')}
            className="h-12 w-full border-b border-border bg-transparent px-4 outline-none placeholder:text-text-subtle"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-text-muted">
              {t('command.empty')}
            </Command.Empty>
            <Command.Group
              heading={t('command.goTo')}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-subtle"
            >
              {NAV_ITEMS.map(({ key, href, icon: Icon }) => (
                <Command.Item
                  key={key}
                  value={`${t(`nav.${key}`)} ${key}`}
                  onSelect={() => {
                    onOpenChange(false);
                    router.push(href);
                  }}
                  className="flex cursor-default items-center gap-3 rounded-md px-2 py-2 data-[selected=true]:bg-surface-3"
                >
                  <Icon aria-hidden className="size-4 text-text-muted" />
                  {t(`nav.${key}`)}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
