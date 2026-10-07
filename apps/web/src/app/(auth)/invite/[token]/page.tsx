import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { describeInvitation } from '@agentos/core';
import { Button } from '@agentos/ui';
import { logoutAction } from '@/app/(auth)/actions';
import { AcceptInvitation } from '@/components/team/accept-invitation';
import { getServices } from '@/server/services';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('team'))('inviteTitle') };
}

type Params = { params: Promise<{ token: string }> };

/** Invitation link: who invited you to which workspace, and Accept (PRD §2 multi-user). */
export default async function InvitationPage({ params }: Params) {
  const { token } = await params;
  const t = await getTranslations('team');
  const invitation = /^[A-Za-z0-9_-]{20,100}$/.test(token)
    ? await describeInvitation(getServices().db, token)
    : null;
  if (!invitation || invitation.status !== 'valid') {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">{t('inviteTitle')}</h1>
        <p className="text-sm text-text-muted">
          {t(`inviteStatus.${(invitation?.status ?? 'unknown') as 'unknown'}`)}
        </p>
      </div>
    );
  }
  const session = await getSession();
  const next = `/invite/${token}`;
  const summary = t('inviteSummary', {
    inviter: invitation.inviterName,
    workspace: invitation.workspaceName,
    role: t(`roles.${invitation.role}`),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('inviteTitle')}</h1>
      <p className="text-sm">{summary}</p>
      <p className="text-xs text-text-muted">{t('inviteFor', { email: invitation.email })}</p>
      {!session ? (
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link
              href={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`}
            >
              {t('signInToAccept')}
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link
              href={`/register?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`}
            >
              {t('createToAccept')}
            </Link>
          </Button>
        </div>
      ) : session.user.email === invitation.email ? (
        <AcceptInvitation token={token} />
      ) : (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg bg-warning/15 px-3 py-2 text-sm">
            {t('wrongAccount', { current: session.user.email, invited: invitation.email })}
          </p>
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('signOutToSwitch')}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
