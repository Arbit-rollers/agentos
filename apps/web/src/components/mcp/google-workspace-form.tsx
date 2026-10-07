'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { Button, Card, CardContent, Field, Input, Select } from '@agentos/ui';
import { connectGoogleAction, type McpFormState } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';

const SERVICES = [
  'gmail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'slides',
  'chat',
  'people',
] as const;
const DEFAULT = new Set<string>(['gmail', 'calendar', 'drive']);

/** MCP Hub → Google Workspace (v0.4.1): pick services and the Google app members sign in with. */
export function GoogleWorkspaceForm({
  platformAvailable,
  redirectUri,
}: {
  platformAvailable: boolean;
  redirectUri: string;
}) {
  const t = useTranslations('mcp');
  const errorText = useErrorText();
  const router = useRouter();
  const [client, setClient] = useState<'platform' | 'own'>(platformAvailable ? 'platform' : 'own');
  const [state, action, pending] = useActionState<McpFormState, FormData>(connectGoogleAction, {});
  useEffect(() => {
    if (state.authorizationUrl) window.location.assign(state.authorizationUrl);
    else if (state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-5">
        <form action={action} className="space-y-5" noValidate>
          <h2 className="font-semibold">{t('google.title')}</h2>
          <p className="text-sm text-text-muted">{t('google.intro')}</p>
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('google.servicesLabel')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SERVICES.map((service) => (
                <label key={service} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="services"
                    value={service}
                    defaultChecked={DEFAULT.has(service)}
                    className="size-4 accent-(--color-primary)"
                  />
                  {t(`google.services.${service}`)}
                </label>
              ))}
            </div>
            {error('services') && <p className="mt-1 text-sm text-danger">{error('services')}</p>}
          </fieldset>
          <input type="hidden" name="client" value={client} />
          <Field
            label={t('google.client')}
            htmlFor="google-client"
            hint={
              client === 'platform'
                ? t('google.platformHint')
                : platformAvailable
                  ? t('google.ownHint', { redirect: redirectUri })
                  : `${t('google.platformMissing')} ${t('google.ownHint', { redirect: redirectUri })}`
            }
            error={error('client')}
          >
            <Select
              id="google-client"
              value={client}
              onValueChange={(value) => setClient(value as 'platform' | 'own')}
              options={(platformAvailable
                ? (['platform', 'own'] as const)
                : (['own'] as const)
              ).map((value) => ({ value, label: t(`google.clients.${value}`) }))}
            />
          </Field>
          {client === 'own' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('form.oauthClientId')} htmlFor="clientId" error={error('clientId')}>
                <Input id="clientId" name="clientId" autoComplete="off" spellCheck={false} />
              </Field>
              <Field
                label={t('form.oauthClientSecret')}
                htmlFor="clientSecret"
                error={error('clientSecret')}
              >
                <Input id="clientSecret" name="clientSecret" type="password" autoComplete="off" />
              </Field>
            </div>
          )}
          <p className="text-xs text-text-muted">{t('google.afterFirst')}</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || Boolean(state.authorizationUrl)}>
              {pending || state.authorizationUrl ? t('form.submitting') : t('google.submit')}
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/mcp">{t('form.cancel')}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
