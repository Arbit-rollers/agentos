import { findRun, listRunsWithDetails, updateRun } from '@agentos/db';
import { createKeyedBreaker } from '@agentos/model-gateway';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createRedis } from '../src/queue';
import {
  enforceRateLimit,
  memoryRateLimiter,
  redisRateLimiter,
  RATE_LIMITS,
} from '../src/rate-limit';
import { executeRun, startChatTurn } from '../src/runtime';
import { createTask, requeueOrphanedRuns } from '../src/tasks';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();
const redis = createRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', 'test-redis');

afterAll(() => redis.disconnect());
afterEach(() => {
  delete fx.deps.rateLimiter;
  delete fx.deps.limits;
});

describe('rate limits (v0.6)', () => {
  it('memory limiter: allows up to the limit per window, then says how long to wait', async () => {
    let clock = 0;
    const limiter = memoryRateLimiter(() => clock);
    for (let i = 0; i < 3; i++) expect((await limiter.hit('k', 3, 1_000)).allowed).toBe(true);
    expect(await limiter.hit('k', 3, 1_000)).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect((await limiter.hit('other', 3, 1_000)).allowed).toBe(true);
    clock = 1_000;
    expect((await limiter.hit('k', 3, 1_000)).allowed).toBe(true);
  });

  it('Redis limiter: shared counter with an expiring window', async () => {
    const limiter = redisRateLimiter(redis, `test:ratelimit:${Date.now()}:`);
    expect((await limiter.hit('k', 2, 5_000)).allowed).toBe(true);
    expect((await limiter.hit('k', 2, 5_000)).allowed).toBe(true);
    const third = await limiter.hit('k', 2, 5_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(third.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it('RATE_LIMITED carries the seconds to wait; no limiter means no limit', async () => {
    const limiter = memoryRateLimiter(() => 0);
    const { limit } = RATE_LIMITS.loginEmail;
    for (let i = 0; i < limit; i++) await enforceRateLimit(limiter, 'loginEmail', 'a@b.c');
    await expect(enforceRateLimit(limiter, 'loginEmail', 'a@b.c')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: ['900'] },
    });
    await expect(enforceRateLimit(undefined, 'loginEmail', 'a@b.c')).resolves.toBeUndefined();
  });

  it('limits how fast a person starts chats and tasks', async () => {
    const s = await fx.setup();
    fx.deps.rateLimiter = memoryRateLimiter(() => 0);
    for (let i = 0; i < RATE_LIMITS.runs.limit; i++) {
      await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: `hello ${i}` });
    }
    await expect(
      startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'one more' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      createTask(fx.db, fx.deps, s.ctx, { agentId: s.agent.id, objective: 'Do it' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('backpressure (v0.6)', () => {
  it('refuses new work a person starts while the workspace queue is full', async () => {
    const s = await fx.setup();
    fx.deps.limits = { maxQueuedRuns: 2 };
    await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'one' });
    await createTask(fx.db, fx.deps, s.ctx, { agentId: s.agent.id, objective: 'two' });
    await expect(
      startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'three' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    // Scheduled work is never dropped; it only waits for a slot.
    await expect(
      createTask(
        fx.db,
        fx.deps,
        s.ctx,
        { agentId: s.agent.id, objective: 'nightly' },
        { kind: 'schedule' },
      ),
    ).resolves.toMatchObject({ state: 'queued' });

    // Another workspace is unaffected.
    const other = await fx.setup();
    await expect(
      startChatTurn(fx.db, fx.deps, other.ctx, other.agent.id, { message: 'hi' }),
    ).resolves.toBeDefined();

    // Once the queue drains, new work is accepted again.
    await fx.drain(s.ctx);
    await expect(
      startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'four' }),
    ).resolves.toBeDefined();
  });

  it('a workspace at its running limit waits its turn instead of taking a worker slot', async () => {
    const s = await fx.setup();
    const busy = await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'busy' });
    const next = await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'next' });
    fx.queue.length = 0;
    await updateRun(fx.db, s.ctx, busy.runId, { status: 'running' });

    fx.deps.limits = { maxRunningRuns: 1, slotWaitMs: 2_000 };
    await executeRun(fx.db, fx.deps, s.ctx, next.runId);
    expect((await findRun(fx.db, s.ctx, next.runId))!.status).toBe('queued');
    expect(fx.queue).toEqual([expect.objectContaining({ runId: next.runId, delayMs: 2_000 })]);

    // A slot frees up: the run goes ahead.
    await updateRun(fx.db, s.ctx, busy.runId, { status: 'completed' });
    fx.queue.length = 0;
    await executeRun(fx.db, fx.deps, s.ctx, next.runId);
    expect((await findRun(fx.db, s.ctx, next.runId))!.status).toBe('completed');
  });
});

describe('MCP circuit breaker (v0.6)', () => {
  it('fails fast on a server that just failed repeatedly, and tells the agent why', async () => {
    const s = await fx.setup();
    const health = createKeyedBreaker({ threshold: 1 });
    fx.deps.mcpHealth = health;
    const connectionId = s.tools.get('search_documents')!.connectionId;
    health.recordFailure(connectionId);
    fx.mcp.calls.length = 0;

    await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, {
      message: 'find [[call:search:{"query":"aviation"}]]',
    });
    await fx.drain(s.ctx);
    expect(fx.mcp.calls).toEqual([]);
    const [run] = await listRunsWithDetails(fx.db, s.ctx, { agentId: s.agent.id });
    expect(run!.toolCalls[0]).toMatchObject({ status: 'failed' });
    expect(run!.toolCalls[0]!.result).toContain('is not responding');
    delete fx.deps.mcpHealth;
  });
});

describe('crash recovery (v0.6)', () => {
  it('re-queues runs whose queue job was lost', async () => {
    const s = await fx.setup();
    const turn = await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message: 'hello' });
    fx.queue.length = 0; // the job vanished with Redis

    // Recent queued runs may just be waiting out a retry delay: left alone.
    expect(await requeueOrphanedRuns(fx.db, fx.deps)).toBe(0);
    const later = new Date(Date.now() + 60 * 60_000);
    expect(await requeueOrphanedRuns(fx.db, fx.deps, 45 * 60_000, later)).toBe(1);
    expect(fx.queue).toEqual([expect.objectContaining({ runId: turn.runId })]);
    await fx.drain(s.ctx);
    expect((await findRun(fx.db, s.ctx, turn.runId))!.status).toBe('completed');
  });
});
