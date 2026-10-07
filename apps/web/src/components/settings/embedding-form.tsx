'use client';

import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useState } from 'react';
import { Button, Field, Input, Select } from '@agentos/ui';
import { saveEmbeddingAction } from '@/app/(app)/settings/knowledge/actions';
import { useErrorText } from '@/components/error-text';

export type EmbeddingProvider = { id: string; name: string; suggestedModel: string };

/** Settings → Knowledge → Embedding model. Saving tests the model before switching. */
export function EmbeddingForm({
  providers,
  current,
}: {
  providers: EmbeddingProvider[];
  current: { connectionId: string; model: string } | null;
}) {
  const t = useTranslations('embedding');
  const errorText = useErrorText();
  const [connectionId, setConnectionId] = useState(current?.connectionId ?? '');
  const [model, setModel] = useState(current?.model ?? '');
  const [state, action, pending] = useActionState(saveEmbeddingAction, {});
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);

  const pick = (id: string) => {
    setConnectionId(id);
    // Prefill the provider's usual embedding model unless one was typed for this provider.
    if (!model || model === providers.find((p) => p.id === connectionId)?.suggestedModel)
      setModel(providers.find((p) => p.id === id)?.suggestedModel ?? '');
  };

  return (
    <form
      // Submitted by hand: React's automatic form reset would clear the provider select.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.name) data.set(submitter.name, submitter.value);
        startTransition(() => action(data));
      }}
      className="grid gap-4 md:grid-cols-2"
      noValidate
    >
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger md:col-span-2"
        >
          {errorText(state.error)}
        </p>
      )}
      {state.ok && !pending && (
        <p
          role="status"
          className="rounded-lg bg-success/15 px-3 py-2 text-sm text-success md:col-span-2"
        >
          {t('saved')}
        </p>
      )}
      <Field label={t('provider')} htmlFor="embedding-provider" error={error('connectionId')}>
        <Select
          id="embedding-provider"
          name="connectionId"
          value={connectionId}
          onValueChange={pick}
          placeholder="—"
          options={providers.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <Field
        label={t('model')}
        htmlFor="embedding-model"
        hint={t('modelHint')}
        error={error('model')}
      >
        <Input
          id="embedding-model"
          name="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className="font-mono"
        />
      </Field>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={pending || !connectionId}>
          {pending ? t('saving') : t('save')}
        </Button>
        {current && (
          <Button type="submit" name="off" value="1" variant="secondary" disabled={pending}>
            {t('turnOff')}
          </Button>
        )}
      </div>
    </form>
  );
}
