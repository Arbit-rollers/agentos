'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@agentos/ui';
import { finishSetupAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';

/** Review step actions for a Draft agent: keep as draft, or create (Draft → Configured). */
export function FinishButtons({ agentId, ready }: { agentId: string; ready: boolean }) {
  const t = useTranslations('wizard');
  const errorText = useErrorText();
  const [draftState, saveDraft, savingDraft] = useActionState<AgentFormState>(
    finishSetupAction.bind(null, agentId, false),
    {},
  );
  const [createState, create, creating] = useActionState<AgentFormState>(
    finishSetupAction.bind(null, agentId, true),
    {},
  );
  const error = createState.error ?? draftState.error;

  return (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      )}
      <div className="flex gap-2">
        <form action={saveDraft}>
          <Button type="submit" variant="secondary" disabled={savingDraft || creating}>
            {t('saveDraft')}
          </Button>
        </form>
        <form action={create}>
          <Button type="submit" disabled={!ready || savingDraft || creating}>
            {creating ? t('saving') : t('create')}
          </Button>
        </form>
      </div>
    </div>
  );
}
