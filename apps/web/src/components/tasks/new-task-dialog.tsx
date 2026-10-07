'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Field,
  Input,
  Select,
  Textarea,
} from '@agentos/ui';
import { createTaskAction, type TaskFormState } from '@/app/(app)/tasks/actions';
import { useErrorText } from '@/components/error-text';

export type TaskOption = { id: string; objective: string };

export function NewTaskDialog({
  agents,
  openTasks,
  defaultAgentId,
}: {
  agents: { id: string; name: string }[];
  /** Unfinished tasks the new one can wait for. */
  openTasks: TaskOption[];
  defaultAgentId?: string;
}) {
  const t = useTranslations('tasksPage');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<TaskFormState, FormData>(
    async (prev, formData) => {
      const result = await createTaskAction(prev, formData);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    {},
  );
  const [dueLocal, setDueLocal] = useState('');

  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);
  // The browser's local time, sent as an absolute instant.
  const dueIso = dueLocal ? new Date(dueLocal).toISOString() : '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('newTask')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('newTask')} className="max-h-[80vh] max-w-xl overflow-y-auto">
        <form action={action} className="space-y-4 p-5" noValidate>
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <Field label={t('agent')} htmlFor="task-agent" error={error('agentId')}>
            <Select
              id="task-agent"
              name="agentId"
              defaultValue={defaultAgentId}
              placeholder={t('chooseAgent')}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Field>
          <Field label={t('objective')} htmlFor="task-objective" error={error('objective')}>
            <Input
              id="task-objective"
              name="objective"
              maxLength={500}
              placeholder={t('objectivePlaceholder')}
            />
          </Field>
          <Field
            label={t('input')}
            htmlFor="task-input"
            hint={t('inputHint')}
            error={error('input')}
          >
            <Textarea id="task-input" name="input" rows={4} maxLength={20000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('priority')} htmlFor="task-priority">
              <Select
                id="task-priority"
                name="priority"
                defaultValue="0"
                options={['0', '1', '2', '3'].map((p) => ({
                  value: p,
                  label: t(`priorities.${p as '0'}`),
                }))}
              />
            </Field>
            <Field label={t('dueAt')} htmlFor="task-due">
              <Input
                id="task-due"
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
              />
              <input type="hidden" name="dueAt" value={dueIso} />
            </Field>
            <Field label={t('maxRetries')} htmlFor="task-retries" error={error('maxRetries')}>
              <Select
                id="task-retries"
                name="maxRetries"
                defaultValue="1"
                options={['0', '1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
              />
            </Field>
          </div>
          {openTasks.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('dependsOn')}</legend>
              <p className="mb-2 text-xs text-text-muted">{t('dependsOnHint')}</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {openTasks.map((task) => (
                  <li key={task.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="dependsOn"
                        value={task.id}
                        className="accent-(--color-primary)"
                      />
                      <span className="truncate">{task.objective}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {error('dependsOn') && (
                <p className="mt-1 text-sm text-danger">{error('dependsOn')}</p>
              )}
            </fieldset>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t('creating') : t('create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
