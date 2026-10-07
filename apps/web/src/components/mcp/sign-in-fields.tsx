'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Field, Input, Select, Textarea } from '@agentos/ui';

const AUTH_TYPES = ['none', 'bearer', 'headers', 'oauth'] as const;
type AuthType = (typeof AUTH_TYPES)[number];

/**
 * How AgentOS signs in to an MCP server: method, who signs in (one shared account or each
 * member), and the credentials. Used by Connect and by Change sign-in method.
 */
export function SignInFields({
  defaultAuthType = 'none',
  defaultCredentialMode = 'shared',
  redirectUri,
  error,
}: {
  defaultAuthType?: AuthType;
  defaultCredentialMode?: 'shared' | 'per_user';
  redirectUri: string;
  error: (field: string) => string | undefined;
}) {
  const t = useTranslations('mcp.form');
  const [authType, setAuthType] = useState<AuthType>(defaultAuthType);
  const [mode, setMode] = useState<'shared' | 'per_user'>(defaultCredentialMode);
  const perUserPossible = authType === 'oauth' || authType === 'bearer';
  const effectiveMode = perUserPossible ? mode : 'shared';

  return (
    <div className="space-y-5">
      <input type="hidden" name="credentialMode" value={effectiveMode} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('authType')} htmlFor="authType">
          <Select
            id="authType"
            name="authType"
            value={authType}
            onValueChange={(value) => setAuthType(value as AuthType)}
            options={AUTH_TYPES.map((value) => ({ value, label: t(`authTypes.${value}`) }))}
          />
        </Field>
        {perUserPossible && (
          <Field
            label={t('credentialMode')}
            htmlFor="credentialMode"
            hint={t('credentialModeHint')}
          >
            <Select
              id="credentialMode"
              value={mode}
              onValueChange={(value) => setMode(value as 'shared' | 'per_user')}
              options={(['shared', 'per_user'] as const).map((value) => ({
                value,
                label: t(`credentialModes.${value}`),
              }))}
            />
          </Field>
        )}
      </div>
      {authType === 'bearer' && (
        <Field
          label={t('token')}
          htmlFor="token"
          error={error('token')}
          hint={effectiveMode === 'per_user' ? t('perUserTokenHint') : t('tokenHint')}
        >
          <Input id="token" name="token" type="password" autoComplete="off" spellCheck={false} />
        </Field>
      )}
      {authType === 'headers' && (
        <Field
          label={t('headers')}
          htmlFor="headers"
          error={error('headers')}
          hint={t('headersHint')}
        >
          <Textarea id="headers" name="headers" rows={3} spellCheck={false} className="font-mono" />
        </Field>
      )}
      {authType === 'oauth' && (
        <>
          <p className="text-sm text-text-muted">{t('oauthHint')}</p>
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm">{t('advanced')}</summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs break-all text-text-muted">
                {t('oauthClientHint', { redirect: redirectUri })}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('oauthClientId')}
                  htmlFor="oauthClientId"
                  error={error('oauthClientId')}
                >
                  <Input
                    id="oauthClientId"
                    name="oauthClientId"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label={t('oauthClientSecret')} htmlFor="oauthClientSecret">
                  <Input
                    id="oauthClientSecret"
                    name="oauthClientSecret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Field label={t('oauthScopes')} htmlFor="oauthScopes" hint={t('oauthScopesHint')}>
                <Input
                  id="oauthScopes"
                  name="oauthScopes"
                  spellCheck={false}
                  className="font-mono"
                />
              </Field>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
