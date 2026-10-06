'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { Agent, AgentType } from '@agentos/db';
import { Card, CardContent, Field, Input, Select, Textarea, cn } from '@agentos/ui';
import { saveBasicsAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { AVATAR_KEYS, AgentAvatar } from '../agent-avatar';
import { TagInput } from './tag-input';
import { WizardNav } from './wizard-nav';

// System agents are internal utilities (PRD §5.1) and aren't created from the wizard.
const SELECTABLE_TYPES = ['master_orchestrator', 'specialist', 'manager'] as const;

export type ParentOption = { id: string; name: string };

export function BasicsForm({
  agent,
  parentOptions,
}: {
  agent?: Agent;
  /** Eligible "Reports to" agents for each type (computed server-side). */
  parentOptions: Record<AgentType, ParentOption[]>;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    saveBasicsAction.bind(null, agent?.id ?? null),
    {},
  );
  const [agentType, setAgentType] = useState<AgentType>(agent?.agentType ?? 'specialist');
  const [avatar, setAvatar] = useState(agent?.avatar ?? 'preset:bot');
  const [parent, setParent] = useState(agent?.parentAgentId ?? 'none');

  const parents = parentOptions[agentType];
  const parentValue = parents.some((p) => p.id === parent) ? parent : 'none';
  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);
  const a11y = (field: string) =>
    error(field) ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` } : {};

  return (
    <form action={action} noValidate>
      {state.error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errorText(state.error)}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-5 pt-5">
              <div>
                <h2 className="font-semibold">{t('wizard.basicTitle')}</h2>
                <p className="text-sm text-text-muted">{t('wizard.basicDescription')}</p>
              </div>
              <Field label={`${t('wizard.name')} *`} htmlFor="name" error={error('name')}>
                <Input
                  id="name"
                  name="name"
                  defaultValue={agent?.name}
                  placeholder={t('wizard.namePlaceholder')}
                  maxLength={80}
                  {...a11y('name')}
                />
              </Field>
              <Field
                label={`${t('wizard.description')} *`}
                htmlFor="description"
                error={error('description')}
              >
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={agent?.description}
                  placeholder={t('wizard.descriptionPlaceholder')}
                  maxLength={500}
                  {...a11y('description')}
                />
              </Field>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">{t('wizard.agentType')}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {SELECTABLE_TYPES.map((type) => (
                    <label
                      key={type}
                      className={cn(
                        'flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
                        agentType === type
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-surface-2 hover:border-border-strong',
                      )}
                    >
                      <input
                        type="radio"
                        name="agentType"
                        value={type}
                        checked={agentType === type}
                        onChange={() => setAgentType(type)}
                        className="mt-0.5 accent-(--color-primary)"
                      />
                      <span>
                        <span className="block font-medium">{t(`agents.types.${type}`)}</span>
                        <span className="block text-xs text-text-muted">
                          {t(`agents.typeHints.${type}`)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {error('agentType') && (
                  <p className="mt-1.5 text-sm text-danger">{error('agentType')}</p>
                )}
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 pt-5">
              <div>
                <h2 className="font-semibold">{t('wizard.roleTitle')}</h2>
                <p className="text-sm text-text-muted">{t('wizard.roleDescription')}</p>
              </div>
              <Field
                label={t('wizard.role')}
                htmlFor="role"
                error={error('role')}
                hint={t('wizard.requiredToCreate')}
              >
                <Input
                  id="role"
                  name="role"
                  defaultValue={agent?.role}
                  placeholder={t('wizard.rolePlaceholder')}
                  maxLength={200}
                  {...a11y('role')}
                />
              </Field>
              <Field
                label={t('wizard.job')}
                htmlFor="jobDefinition"
                error={error('jobDefinition')}
                hint={t('wizard.requiredToCreate')}
              >
                <Textarea
                  id="jobDefinition"
                  name="jobDefinition"
                  rows={4}
                  defaultValue={agent?.jobDefinition}
                  placeholder={t('wizard.jobPlaceholder')}
                  maxLength={4000}
                  {...a11y('jobDefinition')}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label={t('wizard.goals')}
                  htmlFor="goals"
                  hint={t('wizard.onePerLine')}
                  error={error('goals')}
                >
                  <Textarea
                    id="goals"
                    name="goals"
                    rows={4}
                    defaultValue={agent?.goals.join('\n')}
                  />
                </Field>
                <Field
                  label={t('wizard.constraints')}
                  htmlFor="constraints"
                  hint={t('wizard.onePerLine')}
                  error={error('constraints')}
                >
                  <Textarea
                    id="constraints"
                    name="constraints"
                    rows={4}
                    defaultValue={agent?.constraints.join('\n')}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <fieldset>
                <legend className="mb-3 text-sm font-medium">{t('wizard.avatar')}</legend>
                <div className="mb-4 flex justify-center">
                  <AgentAvatar avatar={avatar} size="xl" />
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_KEYS.map((key) => {
                    const value = `preset:${key}`;
                    return (
                      <label
                        key={key}
                        className={cn(
                          'cursor-pointer rounded-full p-0.5 ring-2 has-[:focus-visible]:ring-primary',
                          avatar === value ? 'ring-primary' : 'ring-transparent',
                        )}
                      >
                        <input
                          type="radio"
                          name="avatar"
                          value={value}
                          checked={avatar === value}
                          onChange={() => setAvatar(value)}
                          aria-label={t('wizard.chooseAvatar', { name: key })}
                          className="sr-only"
                        />
                        <AgentAvatar avatar={value} size="sm" />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 pt-5">
              <Field label={t('wizard.tags')} htmlFor="tags-input" error={error('tags')}>
                <TagInput name="tags" id="tags-input" initial={agent?.tags ?? []} />
              </Field>
              <Field
                label={t('agents.reportsTo')}
                htmlFor="parentAgentId"
                error={error('parentAgentId')}
              >
                <Select
                  id="parentAgentId"
                  name="parentAgentId"
                  value={parentValue}
                  onValueChange={setParent}
                  options={[
                    { value: 'none', label: t('agents.noParent') },
                    ...parents.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>

      <WizardNav pending={pending} />
    </form>
  );
}
