'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import { removeMcpAction, testMcpAction } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';

export function DetailActions({ id }: { id: string }) {
  const t = useTranslations('mcp.detail');
  const tm = useTranslations('mcp');
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const describe = (code: string) =>
    code.startsWith('mcp.') ? tm(`errorCodes.${code.slice(4) as 'auth'}`) : errorText(code);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError((await testMcpAction(id)).error);
            })
          }
        >
          {pending && !confirming ? t('testing') : t('test')}
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            start(async () => {
              setError((await removeMcpAction(id)).error);
            });
          }}
        >
          {confirming ? t('confirmDisconnect') : t('disconnect')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {describe(error)}
        </p>
      )}
    </div>
  );
}
