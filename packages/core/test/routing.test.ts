import { listRunsWithDetails } from '@agentos/db';
import { createCircuitBreaker } from '@agentos/model-gateway';
import { afterEach, describe, expect, it } from 'vitest';
import { saveAgentModelConfig } from '../src/models';
import { startChatTurn } from '../src/runtime';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

async function chat(s: Awaited<ReturnType<typeof fx.setup>>, message: string) {
  await startChatTurn(fx.db, fx.deps, s.ctx, s.agent.id, { message });
  await fx.drain(s.ctx);
  return (await listRunsWithDetails(fx.db, s.ctx, { agentId: s.agent.id }))[0]!;
}

afterEach(() => {
  delete fx.deps.modelHealth;
});

describe('Smart Router (v0.6)', () => {
  it('classifies each request and follows the route for its task type', async () => {
    const s = await fx.setup();
    const target = (model: string) => ({ connectionId: s.provider.id, model });
    await saveAgentModelConfig(fx.db, s.ctx, s.agent.id, {
      strategy: 'smart_router',
      primary: target('fake-echo'),
      routes: [{ category: 'research', ...target('fake-local') }],
      fallbacks: [],
      budget: { onExceed: 'stop' },
    });

    const research = await chat(s, 'Research the latest competitors in electric aviation');
    expect(research.taskCategory).toBe('research');
    expect(research.model).toBe('fake-local');
    expect(research.events.find((e) => e.type === 'task.classified')?.payload).toEqual({
      category: 'research',
      signal: 'research',
    });
    expect(research.events.find((e) => e.type === 'model.selected')?.payload).toMatchObject({
      reason: { code: 'route', category: 'research' },
    });

    const other = await chat(s, 'Hi there');
    expect(other.taskCategory).toBe('fast');
    expect(other.model).toBe('fake-echo');
    expect(other.events.find((e) => e.type === 'model.selected')?.payload).toMatchObject({
      reason: { code: 'default_route', category: 'fast' },
    });
  });

  it('stops waiting on a model that keeps failing (circuit breaker)', async () => {
    const s = await fx.setup();
    fx.deps.modelHealth = createCircuitBreaker({ threshold: 1 });
    const target = (model: string) => ({ connectionId: s.provider.id, model });
    await saveAgentModelConfig(fx.db, s.ctx, s.agent.id, {
      strategy: 'fallback_chain',
      primary: target('fake-down'),
      routes: [],
      fallbacks: [target('fake-echo')],
      budget: { onExceed: 'stop' },
    });

    const first = await chat(s, 'Hello');
    expect(first.status).toBe('completed');
    expect(first.events.map((e) => e.type)).toContain('model.fallback');

    const second = await chat(s, 'Hello again');
    expect(second.status).toBe('completed');
    expect(second.events.map((e) => e.type)).not.toContain('model.fallback');
    expect(second.events.find((e) => e.type === 'model.deferred')?.payload).toMatchObject({
      target: { model: 'fake-down' },
      reason: 'circuit_open',
    });
  });
});
