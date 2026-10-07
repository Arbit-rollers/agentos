'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { locales, type Locale } from '@agentos/i18n';
import { Button, Field, Input, Select } from '@agentos/ui';
import { updateProfileAction, type ProfileFormState } from '@/app/(app)/settings/actions';
import { useErrorText } from '@/components/error-text';

export function ProfileForm({
  displayName,
  email,
  locale,
  timezone,
  timezones,
}: {
  displayName: string;
  email: string;
  locale: Locale;
  timezone: string;
  timezones: string[];
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(updateProfileAction, {
    status: 'idle',
  });
  const nameError = errorText(state.fieldErrors?.displayName?.[0]);

  return (
    <form action={action} className="max-w-md space-y-5">
      <Field label={t('settings.displayName')} htmlFor="displayName" error={nameError}>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          autoComplete="name"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'displayName-error' : undefined}
        />
      </Field>
      <Field label={t('settings.email')} htmlFor="email" hint={t('settings.emailHint')}>
        <Input id="email" value={email} disabled readOnly aria-describedby="email-hint" />
      </Field>
      <Field
        label={t('settings.language')}
        htmlFor="locale"
        hint={t('settings.languageHint')}
        error={errorText(state.fieldErrors?.locale?.[0])}
      >
        <Select
          id="locale"
          name="locale"
          defaultValue={locale}
          options={locales.map((value) => ({ value, label: t(`languages.${value}`) }))}
        />
      </Field>
      <Field
        label={t('settings.timezone')}
        htmlFor="timezone"
        hint={t('settings.timezoneHint')}
        error={errorText(state.fieldErrors?.timezone?.[0])}
      >
        <Select
          id="timezone"
          name="timezone"
          defaultValue={timezone}
          options={timezones.map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('settings.saving') : t('settings.save')}
        </Button>
        <p role="status" className="text-sm text-success">
          {state.status === 'saved' && !pending ? t('settings.saved') : ''}
        </p>
      </div>
    </form>
  );
}
