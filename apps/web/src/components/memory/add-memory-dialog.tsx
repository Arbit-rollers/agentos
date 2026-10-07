'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Button, Dialog, DialogContent, DialogTrigger, Field, Select, Textarea } from '@agentos/ui';
import { createMemoryAction } from '@/app/(app)/memory/actions';
import { useErrorText } from '@/components/error-text';

const TYPES = ['procedural', 'semantic', 'episodic'] as const;

export function AddMemoryDialog({
  agents,
  agentId,
}: {
  agents: { id: string; name: string }[];
  agentId?: string;
}) {
  const t = useTranslations('memoryPage');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('procedural');
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createMemoryAction>>, formData: FormData) => {
      const result = await createMemoryAction(prev, formData);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    {},
  );
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('add')} className="max-w-lg">
        <form action={action} className="space-y-4 p-5" noValidate>
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <input type="hidden" name="type" value={type} />
          <Field label={t('type')} htmlFor="memory-type" hint={t(`typeHints.${type}`)}>
            <Select
              id="memory-type"
              value={type}
              onValueChange={(value) => setType(value as (typeof TYPES)[number])}
              options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
            />
          </Field>
          <Field label={t('content')} htmlFor="memory-content" error={error('content')}>
            <Textarea id="memory-content" name="content" rows={4} maxLength={2000} />
          </Field>
          <Field label={t('agent')} htmlFor="memory-agent">
            <Select
              id="memory-agent"
              name="agentId"
              defaultValue={agentId ?? ''}
              options={[
                { value: '', label: t('allAgents') },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pinned" className="size-4 accent-(--color-primary)" />
            {t('pinned')}
            <span className="text-text-subtle">· {t('pinHint')}</span>
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? t('adding') : t('add')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
