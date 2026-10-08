'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button, Dialog, DialogContent, DialogTrigger, Field, Input, Textarea } from '@agentos/ui';
import { createWorkflowAction } from '@/app/(app)/workflows/actions';
import { useErrorText } from '@/components/error-text';
import type { FormState } from '@/server/form-state';

export function NewWorkflowDialog() {
  const t = useTranslations('workflows');
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<FormState, FormData>(createWorkflowAction, {});
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('new')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('new')} className="max-w-lg">
        <form action={action} className="space-y-4 p-5" noValidate>
          <Field
            label={t('name')}
            htmlFor="new-workflow-name"
            error={errorText(state.fieldErrors?.name?.[0])}
          >
            <Input
              id="new-workflow-name"
              name="name"
              maxLength={80}
              placeholder={t('namePlaceholder')}
            />
          </Field>
          <Field label={t('description')} htmlFor="new-workflow-description">
            <Textarea id="new-workflow-description" name="description" rows={3} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? t('creating') : t('create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
