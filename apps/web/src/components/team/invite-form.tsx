'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Button, Field, Input, Select } from '@agentos/ui';
import { inviteMemberAction, type InviteState } from '@/app/(app)/settings/members/actions';
import { useErrorText } from '@/components/error-text';

/** Invite by email; shows the single-use link to share. */
export function InviteForm() {
  const t = useTranslations('team');
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteMemberAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
        <Field
          label={t('email')}
          htmlFor="invite-email"
          error={errorText(state.fieldErrors?.email?.[0])}
        >
          <Input id="invite-email" name="email" type="email" autoComplete="off" className="w-72" />
        </Field>
        <Field label={t('role')} htmlFor="invite-role">
          <Select
            id="invite-role"
            name="role"
            defaultValue="member"
            options={(['member', 'admin'] as const).map((value) => ({
              value,
              label: t(`roles.${value}`),
            }))}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? t('inviting') : t('invite')}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(state.error)}
        </p>
      )}
      {state.link && !pending && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3"
        >
          <p className="text-sm">{t('linkReady', { email: state.email ?? '' })}</p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={state.link}
              aria-label={t('inviteLink')}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(state.link!).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          <p className="text-xs text-text-muted">{t('linkHint', { email: state.email ?? '' })}</p>
        </div>
      )}
    </div>
  );
}
