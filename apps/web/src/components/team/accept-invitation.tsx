'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import { acceptInvitationAction } from '@/app/(auth)/invite/actions';
import { useErrorText } from '@/components/error-text';

export function AcceptInvitation({ token }: { token: string }) {
  const t = useTranslations('team');
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() => start(async () => setError((await acceptInvitationAction(token))?.error))}
      >
        {pending ? t('accepting') : t('accept')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}
