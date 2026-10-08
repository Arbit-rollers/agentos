import { describe, expect, it } from 'vitest';
import { getAnalytics } from '../src/analytics';
import { updateProfile } from '../src/profile';
import { startChatTurn } from '../src/runtime';
import { dayIn, startOfDayIn } from '../src/time';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

describe('analytics (PRD Phase 8)', () => {
  it('aggregates runs, tokens, tools and approvals per workspace', async () => {
    const s = await fx.setup();
    await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, {
      message: 'find [[call:search:{"query":"aviation"}]]',
    });
    await fx.drain(s.ctx);
    await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, {
      message: 'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]',
    });
    await fx.drain(s.ctx);

    const report = await getAnalytics(fx.db, s.ctx, 7);
    expect(report.timezone).toBe('UTC');
    expect(report.days).toHaveLength(7);
    expect(report.days.at(-1)!.day).toBe(dayIn(new Date(), 'UTC'));
    expect(report.totals.runs).toBe(2);
    expect(report.totals.completed).toBe(1);
    expect(report.totals.inputTokens).toBeGreaterThan(0);
    expect(report.days.at(-1)!.completed).toBe(1);

    expect(report.agents).toEqual([
      expect.objectContaining({ agentId: s.agent.id, name: 'Worker', runs: 2, completed: 1 }),
    ]);
    expect(report.models).toEqual([
      expect.objectContaining({ provider: 'openai_compatible', model: 'fake-echo', runs: 2 }),
    ]);
    expect(report.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'search_documents', calls: 1, succeeded: 1 }),
        expect.objectContaining({ toolName: 'gmail_send', needingApproval: 1 }),
      ]),
    );
    expect(report.approvals).toMatchObject({ pending: 1, approved: 0, medianMinutes: null });

    // Another workspace sees none of it.
    const other = await fx.setup();
    const theirs = await getAnalytics(fx.db, other.ctx, 7);
    expect(theirs.totals.runs).toBe(0);
    expect(theirs.agents).toEqual([]);
    expect(theirs.tools).toEqual([]);
  });

  it("buckets days on the person's calendar", async () => {
    const s = await fx.setup();
    await updateProfile(fx.db, s.ctx, {
      displayName: 'Test User',
      locale: 'en',
      timezone: 'Pacific/Kiritimati', // UTC+14: often already "tomorrow" there
    });
    const report = await getAnalytics(fx.db, s.ctx, 30);
    expect(report.timezone).toBe('Pacific/Kiritimati');
    expect(report.days).toHaveLength(30);
    expect(report.days.at(-1)!.day).toBe(dayIn(new Date(), 'Pacific/Kiritimati'));
  });
});

describe('startOfDayIn', () => {
  it('finds local midnight, including on DST changes', () => {
    expect(startOfDayIn('2026-10-08', 'Europe/Istanbul').toISOString()).toBe(
      '2026-10-07T21:00:00.000Z',
    );
    expect(startOfDayIn('2026-03-29', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(startOfDayIn('2026-11-01', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
  });
});
