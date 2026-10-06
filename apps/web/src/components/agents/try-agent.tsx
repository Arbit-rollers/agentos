'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button, Field, Select, Textarea } from '@agentos/ui';
import { runPromptAction, type PromptState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { TASK_CATEGORY_KEYS } from './brain-types';

export function TryAgent({ agentId }: { agentId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<PromptState, FormData>(
    runPromptAction.bind(null, agentId),
    {},
  );
  const errors = [state.error, ...Object.values(state.fieldErrors ?? {}).flat()].filter(
    (code): code is string => Boolean(code),
  );
  const r = state.result;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <Field label={t('runs.prompt')} htmlFor="prompt">
          <Textarea
            id="prompt"
            name="prompt"
            rows={3}
            placeholder={t('runs.promptPlaceholder')}
            maxLength={20000}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label={t('runs.category')} htmlFor="category">
              <Select
                id="category"
                name="category"
                defaultValue="general"
                options={TASK_CATEGORY_KEYS.map((c) => ({
                  value: c,
                  label: t(`brain.categories.${c}`),
                }))}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t('runs.sending') : t('runs.send')}
          </Button>
        </div>
      </form>

      {errors.length > 0 && !pending && (
        <div role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errors.map((code) => (
            <p key={code}>{errorText(code)}</p>
          ))}
        </div>
      )}

      {r && !pending && (
        <div className="rounded-lg border border-border bg-surface-2 p-4" aria-live="polite">
          <p className="mb-2 text-xs text-text-muted">
            {t('runs.servedBy', { model: `${r.provider}/${r.servedBy}` })} ·{' '}
            {t('runs.tokens', {
              input: format.number(r.inputTokens),
              output: format.number(r.outputTokens),
            })}{' '}
            ·{' '}
            {r.costUsd === null
              ? t('runs.costUnknown')
              : t('runs.cost', { cost: format.number(r.costUsd, { maximumFractionDigits: 4 }) })}
          </p>
          <p className="text-sm whitespace-pre-wrap" data-testid="agent-response">
            {r.text}
          </p>
        </div>
      )}
    </div>
  );
}
