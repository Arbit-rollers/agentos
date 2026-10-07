'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import { cancelTaskAction, retryTaskAction } from '@/app/(app)/tasks/actions';
import { useErrorText } from '@/components/error-text';

export function TaskActions({
  id,
  canCancel,
  canRetry,
}: {
  id: string;
  canCancel: boolean;
  canRetry: boolean;
}) {
  const t = useTranslations('tasksPage');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (action: (id: string) => Promise<{ error?: string }>) =>
    start(async () => {
      const result = await action(id);
      setError(result.error);
      router.refresh();
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canCancel && (
          <Button variant="danger" disabled={pending} onClick={() => run(cancelTaskAction)}>
            {t('cancel')}
          </Button>
        )}
        {canRetry && (
          <Button disabled={pending} onClick={() => run(retryTaskAction)}>
            {t('retry')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}
