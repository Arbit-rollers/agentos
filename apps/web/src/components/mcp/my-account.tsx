'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Button, Field, Input, StatusBadge } from '@agentos/ui';
import {
  disconnectMyAccountAction,
  reauthorizeMcpAction,
  saveMyTokenAction,
  type McpFormState,
} from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';

/** Per-user connections: the signed-in person's own account (v0.4.1). */
export function MyAccount({
  id,
  authType,
  connected,
}: {
  id: string;
  authType: 'oauth' | 'bearer';
  connected: boolean;
}) {
  const t = useTranslations('mcp.detail');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [tokenState, saveToken, saving] = useActionState<McpFormState, FormData>(
    saveMyTokenAction.bind(null, id),
    {},
  );
  useEffect(() => {
    if (url) window.location.assign(url);
  }, [url]);

  return (
    <section
      aria-label={t('yourAccount')}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t('yourAccount')}</h3>
        <StatusBadge tone={connected ? 'success' : 'warning'}>
          {connected ? t('authOk') : t('needsAuth')}
        </StatusBadge>
      </div>
      <p className="text-sm text-text-muted">
        {connected ? t('youConnected') : t('youNotConnected')}
      </p>
      {authType === 'oauth' ? (
        <Button
          disabled={pending || Boolean(url)}
          onClick={() =>
            start(async () => {
              const result = await reauthorizeMcpAction(id);
              setError(result.error ?? result.fieldErrors?.endpoint?.[0]);
              if (result.authorizationUrl) setUrl(result.authorizationUrl);
              else router.refresh();
            })
          }
        >
          {t('connectMine')}
        </Button>
      ) : (
        <form action={saveToken} className="flex flex-wrap items-end gap-2">
          <Field
            label={t('yourToken')}
            htmlFor={`my-token-${id}`}
            error={errorText(tokenState.error ?? tokenState.fieldErrors?.token?.[0])}
          >
            <Input
              id={`my-token-${id}`}
              name="token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="w-72"
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {t('saveToken')}
          </Button>
        </form>
      )}
      {connected && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            confirming
              ? start(async () => {
                  await disconnectMyAccountAction(id);
                  setConfirming(false);
                  router.refresh();
                })
              : setConfirming(true)
          }
        >
          {confirming ? t('confirmDisconnectMine') : t('disconnectMine')}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}
