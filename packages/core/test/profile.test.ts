import { listAuditLogs } from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../src/auth';
import { getDashboardSummary } from '../src/dashboard';
import { updateProfile } from '../src/profile';
import { createUser, useTestDb } from './helpers';

const { db } = useTestDb();

describe('updateProfile', () => {
  it('changes the display name and locale and audits it', async () => {
    const { token, ctx } = await createUser(db);
    await updateProfile(db, ctx, { displayName: '  Buğra ', locale: 'tr' });
    const session = await authenticate(db, token);
    expect(session?.user).toMatchObject({ displayName: 'Buğra', locale: 'tr' });
    const actions = (await listAuditLogs(db, ctx)).map((log) => log.action);
    expect(actions).toContain('user.profile_updated');
  });

  it('rejects unsupported locales and empty names', async () => {
    const { ctx } = await createUser(db);
    await expect(updateProfile(db, ctx, { displayName: '', locale: 'de' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { displayName: ['name_required'], locale: expect.any(Array) },
    });
  });
});

describe('getDashboardSummary', () => {
  it('returns seven days of task overview ending today and recent activity', async () => {
    const { ctx } = await createUser(db);
    const summary = await getDashboardSummary(db, ctx, new Date('2026-10-06T12:00:00Z'));
    expect(summary.taskOverview.map((day) => day.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(summary.recentActivity.map((log) => log.action).sort()).toEqual([
      'user.registered',
      'workspace.created',
    ]);
  });
});
