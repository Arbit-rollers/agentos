'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { Button, Card, CardContent, Field, Input, Select, Textarea } from '@agentos/ui';
import { connectMcpAction, type McpFormState } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';

const AUTH_TYPES = ['none', 'bearer', 'headers', 'oauth'] as const;
const TRANSPORTS = ['streamable_http', 'sse'] as const;

export function ConnectForm({
  template,
  templateName,
}: {
  template?: string;
  templateName?: string;
}) {
  const t = useTranslations('mcp');
  const errorText = useErrorText();
  const [authType, setAuthType] = useState<(typeof AUTH_TYPES)[number]>(
    template ? 'oauth' : 'none',
  );
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
            <Field label={t('form.authType')} htmlFor="authType">
              <Select
                id="authType"
                name="authType"
                value={authType}
                onValueChange={(value) => setAuthType(value as typeof authType)}
                options={AUTH_TYPES.map((value) => ({
                  value,
                  label: t(`form.authTypes.${value}`),
                }))}
              />
            </Field>
          </div>
          {authType === 'bearer' && (
            <Field
              label={t('form.token')}
              htmlFor="token"
              error={error('token')}
              hint={t('form.tokenHint')}
            >
              <Input
                id="token"
                name="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
          {authType === 'headers' && (
            <Field
              label={t('form.headers')}
              htmlFor="headers"
              error={error('headers')}
              hint={t('form.headersHint')}
            >
              <Textarea
                id="headers"
                name="headers"
                rows={3}
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          )}
          {authType === 'oauth' && <p className="text-sm text-text-muted">{t('form.oauthHint')}</p>}
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
