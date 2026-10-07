'use client';

import { Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogTrigger } from '@agentos/ui';

/** Gear button + right-hand sheet holding the agent's configuration (PRD v1.2 §20). */
export function SettingsDrawer({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('workspace');
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label={t('settings')}>
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent title={t('settings')} side="right" className="pt-4">
        {children}
      </DialogContent>
    </Dialog>
  );
}
