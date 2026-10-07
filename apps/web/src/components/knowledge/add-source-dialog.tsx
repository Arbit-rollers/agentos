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
import { addKnowledgeAction } from '@/app/(app)/knowledge/actions';
import { useErrorText } from '@/components/error-text';

type SourceType = 'note' | 'file' | 'url';
type Scope = 'workspace' | 'agent' | 'user';

/** Knowledge → Add source (PRD §11): a note, a file or a web page, with who can use it. */
export function AddSourceDialog({
  agents,
  agentId,
}: {
  agents: { id: string; name: string }[];
  /** Set on an agent's Files tab: the source is attached to that agent. */
  agentId?: string;
}) {
  const t = useTranslations('knowledge');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SourceType>('note');
  const [scope, setScope] = useState<Scope>(agentId ? 'agent' : 'workspace');
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof addKnowledgeAction>>, formData: FormData) => {
      const result = await addKnowledgeAction(prev, formData);
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
      <DialogContent title={t('add')} className="max-h-[85vh] max-w-xl overflow-y-auto">
        <form action={action} className="space-y-4 p-5" noValidate>
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="scope" value={scope} />
          {agentId && <input type="hidden" name="agentId" value={agentId} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('type')} htmlFor="source-type">
              <Select
                id="source-type"
                value={type}
                onValueChange={(value) => setType(value as SourceType)}
                options={(['note', 'file', 'url'] as const).map((value) => ({
                  value,
                  label: t(`types.${value}`),
                }))}
              />
            </Field>
            {!agentId && (
              <Field label={t('scope')} htmlFor="source-scope">
                <Select
                  id="source-scope"
                  value={scope}
                  onValueChange={(value) => setScope(value as Scope)}
                  options={(['workspace', 'agent', 'user'] as const).map((value) => ({
                    value,
                    label: t(`scopes.${value}`),
                  }))}
                />
              </Field>
            )}
          </div>
          {!agentId && scope === 'agent' && (
            <Field label={t('agent')} htmlFor="source-agent" error={error('agentId')}>
              <Select
                id="source-agent"
                name="agentId"
                placeholder="—"
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          )}
          <Field
            label={type === 'note' ? t('name') : t('nameOptional')}
            htmlFor="source-name"
            error={error('name')}
          >
            <Input
              id="source-name"
              name="name"
              maxLength={200}
              placeholder={t('namePlaceholder')}
            />
          </Field>
          {type === 'note' && (
            <Field label={t('text')} htmlFor="source-text" error={error('text')}>
              <Textarea id="source-text" name="text" rows={8} />
            </Field>
          )}
          {type === 'file' && (
            <Field
              label={t('file')}
              htmlFor="source-file"
              hint={t('fileHint')}
              error={error('file')}
            >
              <Input
                id="source-file"
                name="file"
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,application/pdf,text/*"
                className="file:mr-3 file:border-0 file:bg-transparent file:text-sm file:text-text"
              />
            </Field>
          )}
          {type === 'url' && (
            <Field label={t('url')} htmlFor="source-url" error={error('url')}>
              <Input id="source-url" name="url" type="url" placeholder="https://" />
            </Field>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t('adding') : t('add')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
