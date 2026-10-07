'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button, Select } from '@agentos/ui';
import {
  changeRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from '@/app/(app)/settings/members/actions';
import { useErrorText } from '@/components/error-text';

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const result = await fn();
      setError(result.error);
      router.refresh();
    });
  return { pending, error, run };
}

/** Role select and Remove for one member (owners and admins). */
export function MemberActions({
  userId,
  name,
  role,
  canManage,
  isSelf,
}: {
  userId: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  canManage: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations('team');
  const errorText = useErrorText();
  const { pending, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const removable = role !== 'owner' && (canManage || isSelf);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canManage && role !== 'owner' && !isSelf ? (
        <Select
          aria-label={`${t('role')}: ${name}`}
          value={role}
          disabled={pending}
          onValueChange={(next) => run(() => changeRoleAction(userId, next))}
          options={(['member', 'admin'] as const).map((value) => ({
            value,
            label: t(`roles.${value}`),
          }))}
          className="w-32"
        />
      ) : (
        <span className="text-sm text-text-muted">{t(`roles.${role}`)}</span>
      )}
      {removable && (
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => (confirming ? run(() => removeMemberAction(userId)) : setConfirming(true))}
        >
          {confirming ? t('confirm') : isSelf ? t('leave') : t('remove')}
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-right text-xs text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

export function RevokeInvitation({ id, email }: { id: string; email: string }) {
  const t = useTranslations('team');
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      aria-label={`${t('revoke')}: ${email}`}
      onClick={() => run(() => revokeInvitationAction(id))}
    >
      {t('revoke')}
    </Button>
  );
}
