'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { Button } from '@agentos/ui';
import { changeSignInAction, type McpFormState } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';
import { SignInFields } from './sign-in-fields';

/** Change how AgentOS signs in to a server, keeping the connection (fixes "added with None"). */
export function ChangeSignInForm({
  id,
  authType,
  credentialMode,
  redirectUri,
}: {
  id: string;
  authType: 'none' | 'bearer' | 'headers' | 'oauth';
  credentialMode: 'shared' | 'per_user';
  redirectUri: string;
}) {
  const t = useTranslations('mcp.detail');
  const errorText = useErrorText();
  const router = useRouter();
  const [state, action, pending] = useActionState<McpFormState, FormData>(
    changeSignInAction.bind(null, id),
    {},
  );
  useEffect(() => {
    if (state.authorizationUrl) window.location.assign(state.authorizationUrl);
    else if (state.ok) router.refresh();
  }, [state, router]);
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('changeSignIn')}</summary>
      <form action={action} className="mt-4 space-y-4" noValidate>
        <p className="text-xs text-text-muted">{t('changeSignInHint')}</p>
        {state.error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
            {errorText(state.error)}
          </p>
        )}
        <SignInFields
          defaultAuthType={authType}
          defaultCredentialMode={credentialMode}
          redirectUri={redirectUri}
          error={error}
        />
        <Button type="submit" disabled={pending || Boolean(state.authorizationUrl)}>
          {t('saveSignIn')}
        </Button>
      </form>
    </details>
  );
}
