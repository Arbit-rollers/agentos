import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NoEligibleModelError,
  ProviderError,
  createAdapter,
  describeModel,
  estimateCost,
  invokeModel,
  planCandidates,
  type GatewayEvent,
  type ModelPlan,
  type ModelTarget,
} from '../src/index';
import { startFakeProvider } from '../src/testing/fake-provider';

const fake = startFakeProvider();
let base = '';
beforeAll(async () => {
  base = (await fake.ready).url;
});
afterAll(() => fake.close());

const target = (
  connectionId: string,
  model: string,
  provider: ModelTarget['provider'] = 'openai_compatible',
): ModelTarget => ({
  connectionId,
  provider,
  model,
});

/** Real adapters pointed at the fake server, keyed by connection id. */
const deps = (events: GatewayEvent[] = []) => ({
  adapterFor: async (t: ModelTarget) =>
    createAdapter({
      provider: t.provider,
      endpoint:
        t.provider === 'anthropic'
          ? `${base}/anthropic`
          : t.provider === 'ollama'
            ? `${base}/openai`
            : `${base}/openai/v1`,
      apiKey: 'sk-test-secret-value-1234567890',
    }),
  capabilitiesFor: (t: ModelTarget) => describeModel(t.provider, t.model),
  onEvent: (event: GatewayEvent) => {
    events.push(event);
  },
});

const request = {
  system: 'You are a test agent.',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('adapters against a fake provider', () => {
  it('OpenAI-compatible: lists models and generates', async () => {
    const adapter = createAdapter({ provider: 'openai_compatible', endpoint: `${base}/openai/v1` });
    expect((await adapter.listModels()).map((m) => m.id)).toContain('fake-echo');
    const result = await adapter.generate({ model: 'fake-echo', ...request });
    expect(result).toMatchObject({
      text: 'echo: hello',
      stopReason: 'end',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it('Ollama uses <endpoint>/v1', async () => {
    const adapter = createAdapter({ provider: 'ollama', endpoint: `${base}/openai/` });
    expect((await adapter.generate({ model: 'fake-local', ...request })).text).toBe('echo: hello');
  });

  it('Anthropic: generates and reports server-side refusal fallbacks', async () => {
    const adapter = createAdapter({
      provider: 'anthropic',
      endpoint: `${base}/anthropic`,
      apiKey: 'sk-ant-test',
    });
    expect((await adapter.listModels()).map((m) => m.id)).toContain('claude-fake');
    expect((await adapter.generate({ model: 'claude-fake', ...request })).text).toBe('echo: hello');

    fake.requests.length = 0;
    const result = await adapter.generate({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'please refuse' }],
    });
    expect(result.providerFallbacks).toEqual([{ from: 'claude-opus-5-5', to: 'claude-fallback' }]);
    expect(result.model).toBe('claude-fallback');
    const sent = fake.requests.at(-1)!;
    expect(sent.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(sent.body).toMatchObject({ fallbacks: 'default', max_tokens: 16000 });
  });

  it('classifies HTTP failures', async () => {
    const adapter = createAdapter({ provider: 'openai_compatible', endpoint: `${base}/openai/v1` });
    await expect(adapter.generate({ model: 'fake-down', ...request })).rejects.toMatchObject({
      kind: 'unavailable',
      status: 503,
    });
    await expect(adapter.generate({ model: 'fake-limited', ...request })).rejects.toMatchObject({
      kind: 'rate_limit',
    });
    const offline = createAdapter({
      provider: 'openai_compatible',
      endpoint: 'http://127.0.0.1:1/v1',
    });
    await expect(offline.listModels()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('rejects a wrong API key as an auth error', async () => {
    const guarded = startFakeProvider({ apiKey: 'right-key' });
    const { url } = await guarded.ready;
    const adapter = createAdapter({
      provider: 'openai',
      endpoint: `${url}/openai/v1`,
      apiKey: 'wrong-key',
    });
    await expect(adapter.listModels()).rejects.toSatisfy(
      (e) => e instanceof ProviderError && e.kind === 'auth',
    );
    await guarded.close();
  });
});

describe('planCandidates (PRD §7.2)', () => {
  const a = target('c1', 'model-a');
  const b = target('c2', 'model-b');
  const c = target('c3', 'model-c');

  it('Fixed: only the primary', () => {
    expect(
      planCandidates({ strategy: 'fixed', primary: a, routes: [], fallbacks: [b] }, 'general'),
    ).toEqual({
      candidates: [a],
      reason: { code: 'fixed' },
    });
  });

  it('Fallback Chain: primary then fallbacks, without duplicates', () => {
    expect(
      planCandidates(
        { strategy: 'fallback_chain', primary: a, routes: [], fallbacks: [b, a, c] },
        'general',
      ).candidates,
    ).toEqual([a, b, c]);
  });

  it('Smart Router: routes by category, else the primary, with the reason recorded', () => {
    const plan: ModelPlan = {
      strategy: 'smart_router',
      primary: a,
      routes: [{ category: 'research', target: b }],
      fallbacks: [c],
    };
    expect(planCandidates(plan, 'research')).toEqual({
      candidates: [b, c],
      reason: { code: 'route', category: 'research' },
    });
    expect(planCandidates(plan, 'fast')).toEqual({
      candidates: [a, c],
      reason: { code: 'default_route', category: 'fast' },
    });
  });
});

describe('invokeModel', () => {
  it('falls back on an outage and records why (AC 11)', async () => {
    const events: GatewayEvent[] = [];
    const down = target('c1', 'fake-down');
    const up = target('c2', 'fake-echo');
    const outcome = await invokeModel(
      {
        plan: { strategy: 'fallback_chain', primary: down, routes: [], fallbacks: [up] },
        category: 'general',
        request,
      },
      deps(events),
    );
    expect(outcome.target).toEqual(up);
    expect(events.map((e) => e.type)).toEqual([
      'model.selected',
      'model.fallback',
      'model.completed',
    ]);
    expect(events[1]).toMatchObject({ type: 'model.fallback', from: down, reason: 'unavailable' });
  });

  it('Fixed does not fall back; configuration errors surface', async () => {
    await expect(
      invokeModel(
        {
          plan: {
            strategy: 'fixed',
            primary: target('c1', 'fake-down'),
            routes: [],
            fallbacks: [],
          },
          category: 'general',
          request,
        },
        deps(),
      ),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('records the routing reason (AC 10)', async () => {
    const events: GatewayEvent[] = [];
    const plan: ModelPlan = {
      strategy: 'smart_router',
      primary: target('c1', 'fake-echo'),
      routes: [{ category: 'private', target: target('c2', 'fake-local', 'ollama') }],
      fallbacks: [],
    };
    const outcome = await invokeModel({ plan, category: 'private', request }, deps(events));
    expect(outcome.target.provider).toBe('ollama');
    expect(events[0]).toEqual({
      type: 'model.selected',
      target: plan.routes[0]!.target,
      reason: { code: 'route', category: 'private' },
    });
  });

  it('skips models that cannot serve the request, with a reason', async () => {
    const events: GatewayEvent[] = [];
    const cloud = target('c1', 'fake-echo');
    const local = target('c2', 'fake-local', 'ollama');
    // "private" tasks require a local model.
    const outcome = await invokeModel(
      {
        plan: { strategy: 'fallback_chain', primary: cloud, routes: [], fallbacks: [local] },
        category: 'private',
        request,
      },
      deps(events),
    );
    expect(outcome.target).toEqual(local);
    expect(events[0]).toEqual({
      type: 'model.skipped',
      target: cloud,
      reason: 'unsupported_modality',
    });

    await expect(
      invokeModel(
        {
          plan: { strategy: 'fixed', primary: cloud, routes: [], fallbacks: [] },
          category: 'vision',
          request,
        },
        deps(),
      ),
    ).rejects.toBeInstanceOf(NoEligibleModelError);
  });

  it('skips a model over the per-call cost threshold', async () => {
    const events: GatewayEvent[] = [];
    const expensive = target('c1', 'claude-fable-5-1', 'anthropic');
    const cheap = target('c2', 'fake-local', 'ollama');
    await invokeModel(
      {
        plan: { strategy: 'fallback_chain', primary: expensive, routes: [], fallbacks: [cheap] },
        category: 'general',
        request: { ...request, maxOutputTokens: 100_000 },
        maxCostUsd: 0.5,
      },
      deps(events),
    );
    expect(events[0]).toEqual({
      type: 'model.skipped',
      target: expensive,
      reason: 'cost_threshold',
    });
  });

  it('only sends temperature to models that accept it', async () => {
    fake.requests.length = 0;
    const plan = (t: ModelTarget): ModelPlan => ({
      strategy: 'fixed',
      primary: t,
      routes: [],
      fallbacks: [],
    });
    await invokeModel(
      {
        plan: plan(target('c1', 'fake-echo')),
        category: 'general',
        request: { ...request, temperature: 0.4 },
      },
      deps(),
    );
    await invokeModel(
      {
        plan: plan(target('c2', 'claude-fake', 'anthropic')),
        category: 'general',
        request: { ...request, temperature: 0.4 },
      },
      deps(),
    );
    const bodies = fake.requests.map((r) => r.body as Record<string, unknown>);
    expect(bodies[0]).toHaveProperty('temperature', 0.4);
    expect(bodies[1]).not.toHaveProperty('temperature');
  });

  it('never puts the API key in the request body (AC 12)', async () => {
    fake.requests.length = 0;
    await invokeModel(
      {
        plan: { strategy: 'fixed', primary: target('c1', 'fake-echo'), routes: [], fallbacks: [] },
        category: 'general',
        request,
      },
      deps(),
    );
    expect(JSON.stringify(fake.requests.map((r) => r.body))).not.toContain('sk-test-secret-value');
  });
});

describe('cost estimation', () => {
  it('uses published prices, zero for local and null when unknown', () => {
    expect(
      estimateCost(describeModel('anthropic', 'claude-opus-5-5'), {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(6);
    expect(
      estimateCost(describeModel('ollama', 'llama'), { inputTokens: 5000, outputTokens: 5000 }),
    ).toBe(0);
    expect(
      estimateCost(describeModel('openai', 'unknown-model'), { inputTokens: 1, outputTokens: 1 }),
    ).toBeNull();
  });
});
