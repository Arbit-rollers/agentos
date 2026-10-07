'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { Button, Card, CardContent, Field, Input, Select } from '@agentos/ui';
import { connectMcpAction, type McpFormState } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';
import { SignInFields } from './sign-in-fields';

const TRANSPORTS = ['streamable_http', 'sse'] as const;

export function ConnectForm({
  template,
  templateName,
  redirectUri,
}: {
  template?: string;
  templateName?: string;
  /** Where OAuth providers send people back to, shown for manual client setup. */
  redirectUri: string;
}) {
  const t = useTranslations('mcp');
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<McpFormState, FormData>(connectMcpAction, {});

  // OAuth: the server hands back the provider's sign-in page; the callback brings us back.
  useEffect(() => {
    if (state.authorizationUrl) window.location.assign(state.authorizationUrl);
  }, [state.authorizationUrl]);

  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-5">
        <form action={action} className="space-y-5" noValidate>
          <h2 className="font-semibold">
            {templateName ? t('form.templateTitle', { name: templateName }) : t('form.title')}
          </h2>
          {template && <p className="text-sm text-text-muted">{t('templateHint')}</p>}
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <input type="hidden" name="serverType" value={template ?? 'custom'} />
          <Field label={t('form.name')} htmlFor="mcp-name" error={error('name')}>
            <Input id="mcp-name" name="name" defaultValue={templateName} maxLength={80} />
          </Field>
          <Field
            label={t('form.endpoint')}
            htmlFor="endpoint"
            error={error('endpoint')}
            hint={t('form.endpointHint')}
          >
            <Input id="endpoint" name="endpoint" type="url" placeholder="https://example.com/mcp" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('form.transport')} htmlFor="transport">
              <Select
                id="transport"
                name="transport"
                defaultValue="streamable_http"
                options={TRANSPORTS.map((value) => ({
                  value,
                  label: t(`form.transports.${value}`),
                }))}
              />
            </Field>
          </div>
          <SignInFields
            defaultAuthType={template ? 'oauth' : 'none'}
            redirectUri={redirectUri}
            error={error}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || Boolean(state.authorizationUrl)}>
              {pending || state.authorizationUrl ? t('form.submitting') : t('form.submit')}
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
