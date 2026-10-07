'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useMemo, useState } from 'react';
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
import { createScheduleAction, type ScheduleFormState } from '@/app/(app)/schedules/actions';
import { useErrorText } from '@/components/error-text';

type Frequency = 'hourly' | 'daily' | 'weekly' | 'custom';
const DAYS = ['1', '2', '3', '4', '5', '6', '0'] as const;

/** Builds the 5-field cron the server stores (minute granularity). */
export function buildCron(
  frequency: Frequency,
  time: string,
  minute: string,
  day: string,
  custom: string,
) {
  const [h = '9', m = '0'] = time.split(':');
  const hh = String(Number(h));
  const mm = String(Number(m));
  switch (frequency) {
    case 'hourly':
      return `${Number(minute) || 0} * * * *`;
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekly':
      return `${mm} ${hh} * * ${day}`;
    case 'custom':
      return custom.trim();
  }
}

export function NewScheduleDialog({ agents }: { agents: { id: string; name: string }[] }) {
  const t = useTranslations('schedules');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ScheduleFormState, FormData>(
    async (prev, formData) => {
      const result = await createScheduleAction(prev, formData);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    {},
  );
  const [kind, setKind] = useState<'recurring' | 'once'>('recurring');
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [time, setTime] = useState('09:00');
  const [minute, setMinute] = useState('0');
  const [day, setDay] = useState('1');
  const [custom, setCustom] = useState('0 9 * * 1');
  const [runAtLocal, setRunAtLocal] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const zones = useMemo(
    () =>
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'],
    [],
  );

  const error = (field: string) => errorText(state.fieldErrors?.[field]?.[0]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('new')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('new')} className="max-h-[85vh] max-w-xl overflow-y-auto">
        <form action={action} className="space-y-4 p-5" noValidate>
          {state.error && (
            <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="timezone" value={timezone} />
          <input
            type="hidden"
            name="cron"
            value={buildCron(frequency, time, minute, day, custom)}
          />
          <input
            type="hidden"
            name="runAt"
            value={runAtLocal ? new Date(runAtLocal).toISOString() : ''}
          />
          <Field label={t('name')} htmlFor="schedule-name" error={error('name')}>
            <Input
              id="schedule-name"
              name="name"
              maxLength={80}
              placeholder={t('namePlaceholder')}
            />
          </Field>
          <Field label={t('agent')} htmlFor="schedule-agent" error={error('agentId')}>
            <Select
              id="schedule-agent"
              name="agentId"
              placeholder="—"
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Field>
          <Field label={t('objective')} htmlFor="schedule-objective" error={error('objective')}>
            <Input id="schedule-objective" name="objective" maxLength={500} />
          </Field>
          <Field label={t('input')} htmlFor="schedule-input">
            <Textarea id="schedule-input" name="input" rows={3} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('kind')} htmlFor="schedule-kind">
              <Select
                id="schedule-kind"
                value={kind}
                onValueChange={(v) => setKind(v as 'recurring' | 'once')}
                options={(['recurring', 'once'] as const).map((k) => ({
                  value: k,
                  label: t(`kinds.${k}`),
                }))}
              />
            </Field>
            <Field label={t('timezone')} htmlFor="schedule-tz" error={error('timezone')}>
              <Select
                id="schedule-tz"
                value={timezone}
                onValueChange={setTimezone}
                options={zones.map((z) => ({ value: z, label: z }))}
              />
            </Field>
          </div>
          {kind === 'once' ? (
            <Field label={t('runAt')} htmlFor="schedule-runat" error={error('runAt')}>
              <Input
                id="schedule-runat"
                type="datetime-local"
                value={runAtLocal}
                onChange={(e) => setRunAtLocal(e.target.value)}
              />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('frequency')} htmlFor="schedule-frequency">
                <Select
                  id="schedule-frequency"
                  value={frequency}
                  onValueChange={(v) => setFrequency(v as Frequency)}
                  options={(['hourly', 'daily', 'weekly', 'custom'] as const).map((f) => ({
                    value: f,
                    label: t(`frequencies.${f}`),
                  }))}
                />
              </Field>
              {frequency === 'hourly' && (
                <Field label={t('minute')} htmlFor="schedule-minute">
                  <Input
                    id="schedule-minute"
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => setMinute(e.target.value)}
                  />
                </Field>
              )}
              {frequency === 'weekly' && (
                <Field label={t('day')} htmlFor="schedule-day">
                  <Select
                    id="schedule-day"
                    value={day}
                    onValueChange={setDay}
                    options={DAYS.map((d) => ({ value: d, label: t(`days.${d}`) }))}
                  />
                </Field>
              )}
              {(frequency === 'daily' || frequency === 'weekly') && (
                <Field label={t('time')} htmlFor="schedule-time">
                  <Input
                    id="schedule-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
              )}
              {frequency === 'custom' && (
                <div className="sm:col-span-2">
                  <Field
                    label={t('cron')}
                    htmlFor="schedule-cron"
                    hint={t('cronHint')}
                    error={error('cron')}
                  >
                    <Input
                      id="schedule-cron"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      className="font-mono"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
          {kind === 'recurring' && frequency !== 'custom' && error('cron') && (
            <p className="text-sm text-danger">{error('cron')}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t('creating') : t('create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
