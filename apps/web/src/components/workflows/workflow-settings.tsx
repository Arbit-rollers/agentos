'use client';

import { CalendarClock, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { Button, Field, Input, Select, Switch, Textarea } from '@agentos/ui';
import {
  addWorkflowScheduleAction,
  removeWorkflowScheduleAction,
  setWorkflowActiveAction,
} from '@/app/(app)/workflows/actions';
import { useErrorText } from '@/components/error-text';
import { buildCron } from '@/components/schedules/new-schedule-dialog';
import type { FormState } from '@/server/form-state';

export type WorkflowScheduleView = { id: string; name: string; when: string; timezone: string };

/** Right column with no step selected: Workflow Settings (Screen 9). */
export function WorkflowSettings({
  id,
  name,
  description,
  onName,
  onDescription,
  active,
  canManage,
  schedules,
}: {
  id: string;
  name: string;
  description: string;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  active: boolean;
  canManage: boolean;
  schedules: WorkflowScheduleView[];
}) {
  const t = useTranslations('workflows');
  const ts = useTranslations('schedules');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'custom'>('weekly');
  const [time, setTime] = useState('09:00');
  const [day, setDay] = useState('1');
  const [custom, setCustom] = useState('0 9 * * 1');
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [state, addSchedule, adding] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await addWorkflowScheduleAction(id, prev, formData);
      if (result.ok) router.refresh();
      return result;
    },
    {},
  );

  return (
    <section
      aria-label={t('settings')}
      className="space-y-4 rounded-(--radius-card) border border-border bg-surface p-4"
    >
      <h3 className="text-sm font-semibold">{t('settings')}</h3>
      <fieldset disabled={!canManage} className="space-y-4">
        <Field label={t('name')} htmlFor="workflow-name">
          <Input
            id="workflow-name"
            value={name}
            maxLength={80}
            onChange={(e) => onName(e.target.value)}
          />
        </Field>
        <Field label={t('description')} htmlFor="workflow-description">
          <Textarea
            id="workflow-description"
            rows={3}
            value={description}
            onChange={(e) => onDescription(e.target.value)}
          />
        </Field>
      </fieldset>

      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="size-4" aria-hidden />
          {t('trigger')}
        </h4>
        {schedules.length === 0 ? (
          <p className="text-xs text-text-muted">{t('manualOnly')}</p>
        ) : (
          <ul className="space-y-1 text-sm" aria-label={t('schedulesLabel')}>
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{s.when}</span>
                  <span className="block text-xs text-text-subtle">{s.timezone}</span>
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t('removeSchedule')}: ${s.when}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await removeWorkflowScheduleAction(id, s.id);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form action={addSchedule} className="space-y-2">
            <input type="hidden" name="cron" value={buildCron(frequency, time, '0', day, custom)} />
            <input type="hidden" name="timezone" value={timezone} />
            <input type="hidden" name="name" value={`${name} (${t('schedule')})`} />
            <div className="grid grid-cols-2 gap-2">
              <Select
                aria-label={ts('frequency')}
                value={frequency}
                onValueChange={(v) => setFrequency(v as typeof frequency)}
                options={(['daily', 'weekly', 'custom'] as const).map((f) => ({
                  value: f,
                  label: ts(`frequencies.${f}`),
                }))}
              />
              {frequency === 'weekly' && (
                <Select
                  aria-label={ts('day')}
                  value={day}
                  onValueChange={setDay}
                  options={['1', '2', '3', '4', '5', '6', '0'].map((d) => ({
                    value: d,
                    label: ts(`days.${d as '1'}`),
                  }))}
                />
              )}
              {frequency !== 'custom' && (
                <Input
                  aria-label={ts('time')}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              )}
              {frequency === 'custom' && (
                <Input
                  aria-label={ts('cron')}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="col-span-2 font-mono text-xs"
                />
              )}
            </div>
            {(state.error || state.fieldErrors?.cron) && (
              <p className="text-xs text-danger">
                {errorText(state.error ?? state.fieldErrors?.cron?.[0])}
              </p>
            )}
            <Button type="submit" size="sm" variant="secondary" disabled={adding}>
              {t('addSchedule')}
            </Button>
          </form>
        )}
      </div>

      <label className="flex items-start gap-3 border-t border-border pt-3">
        <Switch
          checked={active}
          disabled={!canManage || pending}
          aria-label={t('active')}
          onCheckedChange={(next) =>
            start(async () => {
              const result = await setWorkflowActiveAction(id, next);
              setError(result.error ?? result.fieldErrors?.graph?.[0]);
              router.refresh();
            })
          }
        />
        <span>
          <span className="block text-sm font-medium">{t('active')}</span>
          <span className="block text-xs text-text-muted">{t('activeHint')}</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}
