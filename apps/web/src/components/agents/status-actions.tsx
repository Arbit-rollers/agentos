'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { AgentAction } from '@agentos/core';
import { Button } from '@agentos/ui';
import { changeStatusAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';

function ActionButton({
  agentId,
  action,
  disabled,
}: {
  agentId: string;
  action: AgentAction;
  disabled: boolean;
}) {
  const t = useTranslations('agents.actions');
  const errorText = useErrorText();
  const [state, submit, pending] = useActionState<AgentFormState>(
    changeStatusAction.bind(null, agentId, action),
    {},
  );
  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <Button
        type="submit"
        variant={action === 'archive' ? 'danger' : action === 'pause' ? 'secondary' : 'primary'}
        disabled={pending || disabled}
      >
        {t(action)}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {errorText(state.error)}
        </p>
      )}
    </form>
  );
}

/** Lifecycle buttons for the actions the agent's current status allows (PRD §5.2). */
export function StatusActions({
  agentId,
  actions,
  canRun,
}: {
  agentId: string;
  actions: AgentAction[];
  /** False until the agent has an AI model (M4): Activate and Resume stay disabled. */
  canRun: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {actions.map((action) => (
        <ActionButton
          key={action}
          agentId={agentId}
          action={action}
          disabled={!canRun && (action === 'activate' || action === 'resume')}
        />
      ))}
    </div>
  );
}
