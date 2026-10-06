'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import { removeProviderAction, testProviderAction } from '@/app/(app)/settings/providers/actions';
import { useErrorText } from '@/components/error-text';

export function ProviderActions({ id, name }: { id: string; name: string }) {
  const t = useTranslations('providers');
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);

  const run = (action: () => Promise<{ error?: string }>, isTest: boolean) =>
    startTransition(async () => {
      setTesting(isTest);
      setError(undefined);
      const result = await action();
      setError(result.error);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          aria-label={`${t('test')} ${name}`}
          onClick={() => run(() => testProviderAction(id), true)}
        >
          {pending && testing ? t('testing') : t('test')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          aria-label={`${t('remove')} ${name}`}
          onClick={() => run(() => removeProviderAction(id), false)}
        >
          {t('remove')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}
