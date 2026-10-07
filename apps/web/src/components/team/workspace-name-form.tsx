'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button, Field, Input } from '@agentos/ui';
import { renameWorkspaceAction } from '@/app/(app)/settings/members/actions';
import { useErrorText } from '@/components/error-text';
import type { FormState } from '@/server/form-state';

export function WorkspaceNameForm({ name, canEdit }: { name: string; canEdit: boolean }) {
  const t = useTranslations('team');
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<FormState, FormData>(renameWorkspaceAction, {});
  if (!canEdit) return <p className="text-sm">{name}</p>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field
        label={t('workspaceName')}
        htmlFor="workspace-name"
        error={errorText(state.fieldErrors?.name?.[0] ?? state.error)}
      >
        <Input
          id="workspace-name"
          name="name"
          defaultValue={name}
          maxLength={80}
          className="w-72"
        />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('save')}
      </Button>
      {state.ok && !pending && (
        <span role="status" className="text-sm text-success">
          {t('saved')}
        </span>
      )}
    </form>
  );
}
