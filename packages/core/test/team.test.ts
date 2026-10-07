import {
  findMyMcpCredential,
  insertMemory,
  listAuditLogs,
  listMemories,
  listWorkspaceMembers,
  listWorkspacesForUser,
} from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../src/auth';
import { createSchedule } from '../src/schedules';
import {
  acceptInvitation,
  changeMemberRole,
  describeInvitation,
  inviteMember,
  removeMember,
  revokeInvitation,
  switchWorkspace,
} from '../src/team';
import { createUser } from './helpers';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();
const scheduler = { upsert: async () => {}, remove: async () => {}, list: async () => [] };

async function invited(role: 'admin' | 'member' = 'member') {
  const owner = await fx.setup();
  const guest = await createUser(fx.db);
  const { token } = await inviteMember(fx.db, owner.ctx, { email: guest.user.email, role });
  return { owner, guest, token };
}

describe('workspace invitations', () => {
  it('the invited person joins, the session switches, and the link is single use', async () => {
    const { owner, guest, token } = await invited();
    expect(await describeInvitation(fx.db, token)).toMatchObject({
      workspaceName: 'Personal',
      email: guest.user.email,
      role: 'member',
      status: 'valid',
    });
    const workspaceId = await acceptInvitation(fx.db, guest.user.id, guest.token, token);
    expect(workspaceId).toBe(owner.ctx.workspaceId);
    const session = await authenticate(fx.db, guest.token);
    expect(session).toMatchObject({ ctx: { workspaceId: owner.ctx.workspaceId }, role: 'member' });
    expect((await listWorkspaceMembers(fx.db, owner.ctx)).map((m) => m.role)).toEqual([
      'owner',
      'member',
    ]);
    expect((await describeInvitation(fx.db, token))!.status).toBe('used');
    await expect(acceptInvitation(fx.db, guest.user.id, guest.token, token)).rejects.toMatchObject({
      details: { invitation: ['invite_invalid'] },
    });

    // Switching back and forth between own and team workspace.
    const mine = (await listWorkspacesForUser(fx.db, guest.user.id)).find(
      (w) => w.role === 'owner',
    )!;
    await switchWorkspace(fx.db, guest.user.id, guest.token, mine.id);
    expect((await authenticate(fx.db, guest.token))!.ctx.workspaceId).toBe(mine.id);
    await expect(
      switchWorkspace(fx.db, guest.user.id, guest.token, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only the invited email can accept; expired and revoked links fail', async () => {
    const { owner, guest, token } = await invited();
    const stranger = await createUser(fx.db);
    await expect(
      acceptInvitation(fx.db, stranger.user.id, stranger.token, token),
    ).rejects.toMatchObject({
      details: { invitation: ['invite_wrong_account'] },
    });
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect((await describeInvitation(fx.db, token, later))!.status).toBe('expired');
    await expect(
      acceptInvitation(fx.db, guest.user.id, guest.token, token, later),
    ).rejects.toMatchObject({
      details: { invitation: ['invite_invalid'] },
    });
    const { invitation, token: second } = await inviteMember(fx.db, owner.ctx, {
      email: guest.user.email,
      role: 'admin',
    });
    expect((await describeInvitation(fx.db, token))!.status).toBe('revoked'); // replaced
    await revokeInvitation(fx.db, owner.ctx, invitation.id);
    expect((await describeInvitation(fx.db, second))!.status).toBe('revoked');
  });

  it('members cannot manage members; admins can; the owner stays owner', async () => {
    const { owner, guest, token } = await invited();
    await acceptInvitation(fx.db, guest.user.id, guest.token, token);
    const member = { workspaceId: owner.ctx.workspaceId, userId: guest.user.id };
    await expect(
      inviteMember(fx.db, member, { email: 'x@example.com', role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(changeMemberRole(fx.db, member, owner.ctx.userId, 'member')).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await changeMemberRole(fx.db, owner.ctx, guest.user.id, 'admin');
    await expect(changeMemberRole(fx.db, member, owner.ctx.userId, 'member')).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(
      inviteMember(fx.db, member, { email: guest.user.email, role: 'member' }),
    ).rejects.toMatchObject({
      details: { email: ['already_member'] },
    });
    await expect(removeMember(fx.db, fx.deps, owner.ctx, owner.ctx.userId)).rejects.toMatchObject({
      details: { member: ['owner_cannot_leave'] },
    });
    const audit = await listAuditLogs(fx.db, owner.ctx, { limit: 20 });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['member.invited', 'member.joined', 'member.role_changed']),
    );
  });

  it('removing a member takes their private data with them and pauses their schedules', async () => {
    const { owner, guest, token } = await invited();
    await acceptInvitation(fx.db, guest.user.id, guest.token, token);
    const member = { workspaceId: owner.ctx.workspaceId, userId: guest.user.id };
    await insertMemory(fx.db, member, {
      agentId: null,
      type: 'semantic',
      content: 'Private fact',
      provenance: { kind: 'manual' },
    });
    await insertMemory(fx.db, owner.ctx, {
      agentId: null,
      type: 'semantic',
      content: 'Owner fact',
      provenance: { kind: 'manual' },
    });
    const schedule = await createSchedule(fx.db, { ...fx.deps, scheduler }, member, {
      agentId: owner.agent.id,
      name: 'Daily',
      objective: 'Check',
      kind: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
    });

    const removed = await removeMember(fx.db, fx.deps, owner.ctx, guest.user.id);
    expect(removed.pausedScheduleIds).toEqual([schedule.id]);
    expect(await listMemories(fx.db, member, {})).toHaveLength(0);
    expect(await listMemories(fx.db, owner.ctx, {})).toHaveLength(1);
    expect(await findMyMcpCredential(fx.db, member, owner.ctx.workspaceId)).toBeUndefined();
    // Their session falls back to their own workspace instead of logging them out.
    const session = await authenticate(fx.db, guest.token);
    expect(session!.ctx.workspaceId).not.toBe(owner.ctx.workspaceId);
  });

  it('anyone but the owner can leave', async () => {
    const { owner, guest, token } = await invited();
    await acceptInvitation(fx.db, guest.user.id, guest.token, token);
    await removeMember(
      fx.db,
      fx.deps,
      { workspaceId: owner.ctx.workspaceId, userId: guest.user.id },
      guest.user.id,
    );
    expect(await listWorkspaceMembers(fx.db, owner.ctx)).toHaveLength(1);
    const audit = await listAuditLogs(fx.db, owner.ctx, { limit: 5 });
    expect(audit[0]!.action).toBe('member.left');
  });
});
