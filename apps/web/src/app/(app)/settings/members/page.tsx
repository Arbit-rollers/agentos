import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listPendingInvitations, listWorkspaceMembers } from '@agentos/db';
import { Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { InviteForm } from '@/components/team/invite-form';
import { MemberActions, RevokeInvitation } from '@/components/team/member-actions';
import { WorkspaceNameForm } from '@/components/team/workspace-name-form';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('team'))('title') };
}

/** Settings → Members: who's in this workspace, invitations, roles (multi-user, PRD §2). */
export default async function MembersPage() {
  const { ctx, role, workspace } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations('team');
  const format = await getFormatter();
  const canManage = role === 'owner' || role === 'admin';
  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(db, ctx),
    canManage ? listPendingInvitations(db, ctx) : [],
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle>{t('workspace')}</CardTitle>
          <p className="text-sm text-text-muted">{t('workspaceHint')}</p>
        </CardHeader>
        <CardContent>
          <WorkspaceNameForm name={workspace.name} canEdit={canManage} />
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader className="flex-col items-start gap-1">
            <CardTitle>{t('inviteHeading')}</CardTitle>
            <p className="text-sm text-text-muted">{t('inviteHint')}</p>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('members', { count: members.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label={t('membersLabel')}>
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-member={member.email}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {member.displayName || member.email}
                    {member.userId === ctx.userId && (
                      <span className="ml-2 text-xs text-text-subtle">{t('you')}</span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    {member.email} ·{' '}
                    {t('joined', {
                      date: format.dateTime(member.joinedAt, { dateStyle: 'medium' }),
                    })}
                  </p>
                </div>
                <MemberActions
                  userId={member.userId}
                  name={member.displayName || member.email}
                  role={member.role}
                  canManage={canManage}
                  isSelf={member.userId === ctx.userId}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {canManage && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pending')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border" aria-label={t('pending')}>
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-text-muted">
                      {t(`roles.${invitation.role}`)} ·{' '}
                      {t('expires', {
                        date: format.dateTime(invitation.expiresAt, { dateStyle: 'medium' }),
                      })}
                    </p>
                  </div>
                  <RevokeInvitation id={invitation.id} email={invitation.email} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
