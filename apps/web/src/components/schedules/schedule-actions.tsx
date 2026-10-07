'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import {
  deleteScheduleAction,
  runScheduleNowAction,
  setScheduleActiveAction,
} from '@/app/(app)/schedules/actions';

export function ScheduleActions({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const t = useTranslations('schedules');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        aria-label={`${t('runNow')}: ${name}`}
        onClick={() => run(() => runScheduleNowAction(id))}
      >
        {t('runNow')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => setScheduleActiveAction(id, !active))}
      >
        {active ? t('pause') : t('resume')}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => (confirming ? run(() => deleteScheduleAction(id)) : setConfirming(true))}
      >
        {confirming ? t('confirmDelete') : t('delete')}
      </Button>
    </div>
  );
}
