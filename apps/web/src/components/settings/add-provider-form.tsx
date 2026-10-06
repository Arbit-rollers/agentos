'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Select } from '@agentos/ui';
import { addProviderAction, type ProviderFormState } from '@/app/(app)/settings/providers/actions';
import { useErrorText } from '@/components/error-text';

const KINDS = ['openai', 'anthropic', 'google', 'ollama', 'openai_compatible'] as const;
type Kind = (typeof KINDS)[number];

export function AddProviderForm({ ollamaDefault }: { ollamaDefault: string }) {
  const t = useTranslations('providers');
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<Kind>('openai');
  const [state, action, pending] = useActionState<ProviderFormState, FormData>(addProviderAction, {
    status: 'idle',
  });
  useEffect(() => {
    if (state.status === 'saved') formRef.current?.reset();
  }, [state]);

  const needsKey = kind === 'openai' || kind === 'anthropic' || kind === 'google';
  const needsEndpoint = kind === 'ollama' || kind === 'openai_compatible';
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);

  return (
    <form ref={formRef} action={action} className="grid gap-4 md:grid-cols-2" noValidate>
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger md:col-span-2"
        >
          {errorText(state.error)}
        </p>
      )}
      <Field label={t('provider')} htmlFor="provider">
        <Select
          id="provider"
          name="provider"
          value={kind}
          onValueChange={(value) => setKind(value as Kind)}
          options={KINDS.map((value) => ({ value, label: t(`kinds.${value}`) }))}
        />
      </Field>
      <Field label={t('name')} htmlFor="provider-name" error={error('name')}>
        <Input
          id="provider-name"
          name="name"
          defaultValue={t(`kinds.${kind}`)}
          key={kind}
          placeholder={t('namePlaceholder')}
          maxLength={60}
        />
      </Field>
      {needsEndpoint && (
        <Field
          label={t('endpoint')}
          htmlFor="endpoint"
          error={error('endpoint')}
          hint={kind === 'ollama' ? t('endpointHintOllama') : t('endpointHintCompatible')}
        >
          <Input
            id="endpoint"
            name="endpoint"
            key={kind}
            type="url"
            defaultValue={kind === 'ollama' ? ollamaDefault : ''}
            placeholder={kind === 'ollama' ? ollamaDefault : 'https://example.com/v1'}
          />
        </Field>
      )}
      {kind !== 'ollama' && (
        <Field
          label={needsKey ? t('apiKey') : t('apiKeyOptional')}
          htmlFor="apiKey"
          error={error('apiKey')}
          hint={t('apiKeyHint')}
        >
          <Input id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} />
        </Field>
      )}
      <div className="flex items-end md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('adding') : t('add')}
        </Button>
      </div>
    </form>
  );
}
