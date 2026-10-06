import { findAgent, listAgentRuns, listAuditLogs } from '@agentos/db';
import { startFakeProvider } from '@agentos/model-gateway/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  updatePersonality,
} from '../src/agents';
import { createSecretCipher } from '../src/crypto';
import { getDashboardSummary } from '../src/dashboard';
import { AppError } from '../src/errors';
import {
  buildSystemPrompt,
  runAgentPrompt,
  saveAgentModelConfig,
  type ModelConfigInput,
} from '../src/models';
import {
  createProviderConnection,
  removeProviderConnection,
  testProviderConnection,
  type ProviderDeps,
} from '../src/providers';
import { createSecretStore } from '../src/secrets';
import { createUser, useTestDb } from './helpers';

const { db, sql } = useTestDb();
const fake = startFakeProvider();
let base = '';
beforeAll(async () => {
  base = (await fake.ready).url;
});
afterAll(() => fake.close());

const deps: ProviderDeps = {
  secrets: createSecretStore(db, createSecretCipher(Buffer.alloc(32, 3).toString('base64'))),
};
const API_KEY = 'sk-live-very-secret-key-0123456789';

async function setup() {
  const user = await createUser(db);
  const cloud = await createProviderConnection(db, deps, user.ctx, {
    provider: 'openai_compatible',
    name: 'Cloud',
    endpoint: `${base}/openai/v1`,
    apiKey: API_KEY,
  });
  const local = await createProviderConnection(db, deps, user.ctx, {
    provider: 'ollama',
    name: 'Local Ollama',
    endpoint: `${base}/openai`,
  });
  const agent = await completeAgentSetup(
    db,
    user.ctx,
    (
      await createAgent(db, user.ctx, {
        name: 'Fact Checker',
        description: 'Checks facts',
        agentType: 'specialist',
        avatar: 'preset:plane',
        tags: [],
        parentAgentId: null,
        role: 'Aviation Fact Checker',
        jobDefinition: 'Verify claims.',
        goals: ['Zero errors'],
        constraints: [],
      })
    ).id,
  );
  return { ...user, cloud, local, agent };
}

const fixed = (connectionId: string, model: string): ModelConfigInput => ({
  strategy: 'fixed',
  primary: { connectionId, model },
  routes: [],
  fallbacks: [],
  budget: { onExceed: 'stop' },
});

describe('provider connections (PRD §7.4)', () => {
  it('tests the connection, lists models and keeps the key encrypted', async () => {
    const { cloud, local } = await setup();
    expect(cloud.status).toBe('connected');
    expect(cloud.models.map((m) => m.id)).toContain('fake-echo');
    expect(local).toMatchObject({ status: 'connected', secretId: null });
    const dump =
      JSON.stringify(await sql`select * from provider_connections`) +
      JSON.stringify(await sql`select * from secrets`);
    expect(dump).not.toContain(API_KEY);
  });

  it('marks unreachable providers as errors with a short code', async () => {
    const { ctx } = await createUser(db);
    const broken = await createProviderConnection(db, deps, ctx, {
      provider: 'openai_compatible',
      name: 'Offline',
      endpoint: 'http://127.0.0.1:1/v1',
    });
    expect(broken).toMatchObject({ status: 'error', lastError: 'unavailable' });
  });

  it('validates required fields per provider', async () => {
    const { ctx } = await createUser(db);
    await expect(
      createProviderConnection(db, deps, ctx, { provider: 'anthropic', name: 'A' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { apiKey: ['api_key_required'] },
    });
    await expect(
      createProviderConnection(db, deps, ctx, {
        provider: 'ollama',
        name: 'O',
        endpoint: 'file:///etc/passwd',
      }),
    ).rejects.toMatchObject({ details: { endpoint: ['invalid_endpoint'] } });
  });

  it('cannot remove a provider an agent uses', async () => {
    const { ctx, cloud, agent } = await setup();
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-echo'));
    await expect(removeProviderConnection(db, deps, ctx, cloud.id)).rejects.toMatchObject({
      code: 'PROVIDER_IN_USE',
    });
  });

  it('is isolated per workspace (AC 2)', async () => {
    const { cloud } = await setup();
    const other = await createUser(db);
    await expect(testProviderConnection(db, deps, other.ctx, cloud.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(removeProviderConnection(db, deps, other.ctx, cloud.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('agent model configuration (PRD §7)', () => {
  it('one agent on a cloud model, another on a local model (AC 6, 7, 9)', async () => {
    const { ctx, cloud, local, agent } = await setup();
    const second = await completeAgentSetup(
      db,
      ctx,
      (
        await createAgent(db, ctx, {
          ...agent,
          name: 'Local Agent',
          tags: [],
          parentAgentId: null,
          avatar: 'preset:bot',
        })
      ).id,
    );
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-echo'));
    await saveAgentModelConfig(db, ctx, second.id, fixed(local.id, 'fake-local'));

    const a = await runAgentPrompt(db, deps, ctx, agent.id, { prompt: 'hi cloud' });
    const b = await runAgentPrompt(db, deps, ctx, second.id, { prompt: 'hi local' });
    expect(a).toMatchObject({
      text: 'echo: hi cloud',
      provider: 'openai_compatible',
      model: 'fake-echo',
    });
    expect(b).toMatchObject({ text: 'echo: hi local', provider: 'ollama', costUsd: 0 });
  });

  it('changing the model keeps identity, personality and role (AC 8)', async () => {
    const { ctx, cloud, local, agent } = await setup();
    await updatePersonality(db, ctx, agent.id, { traits: { skeptical: 95 } });
    const before = await findAgent(db, ctx, agent.id);
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-echo'));
    await saveAgentModelConfig(db, ctx, agent.id, fixed(local.id, 'fake-local'));
    const after = await findAgent(db, ctx, agent.id);
    expect(after).toEqual(before);
    const log = (await listAuditLogs(db, ctx)).find((l) => l.action === 'agent.model_changed');
    expect(log?.metadata).toMatchObject({
      before: { primary: 'openai_compatible/fake-echo' },
      after: { primary: 'ollama/fake-local' },
    });
  });

  it('rejects models the provider does not offer and other workspaces’ providers', async () => {
    const { ctx, cloud, agent } = await setup();
    await expect(
      saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'gpt-imaginary')),
    ).rejects.toMatchObject({
      details: { primary: ['unknown_model'] },
    });
    const other = await setup();
    await expect(
      saveAgentModelConfig(db, ctx, agent.id, fixed(other.cloud.id, 'fake-echo')),
    ).rejects.toMatchObject({
      details: { primary: ['provider_required'] },
    });
  });

  it('records routing reasons and fallbacks on the run (AC 10, 11)', async () => {
    const { ctx, cloud, local, agent } = await setup();
    await saveAgentModelConfig(db, ctx, agent.id, {
      strategy: 'smart_router',
      primary: { connectionId: cloud.id, model: 'fake-down' },
      routes: [{ category: 'private', connectionId: local.id, model: 'fake-local' }],
      fallbacks: [{ connectionId: cloud.id, model: 'fake-echo' }],
      budget: { onExceed: 'stop' },
    });

    const routed = await runAgentPrompt(db, deps, ctx, agent.id, {
      prompt: 'secret stuff',
      category: 'private',
    });
    expect(routed.provider).toBe('ollama');
    const fellBack = await runAgentPrompt(db, deps, ctx, agent.id, {
      prompt: 'hello',
      category: 'research',
    });
    expect(fellBack.model).toBe('fake-echo');

    const [latest, first] = await listAgentRuns(db, ctx, agent.id);
    expect(first!.events.map((e) => e.type)).toEqual(['model.selected', 'model.completed']);
    expect(first!.events[0]!.payload).toMatchObject({
      reason: { code: 'route', category: 'private' },
    });
    expect(latest!.events.map((e) => e.type)).toEqual([
      'model.selected',
      'model.fallback',
      'model.completed',
    ]);
    expect(latest!.events[0]!.payload).toMatchObject({
      reason: { code: 'default_route', category: 'research' },
    });
    expect(latest!.events[1]!.payload).toMatchObject({
      reason: 'unavailable',
      from: { model: 'fake-down' },
    });
    expect(latest).toMatchObject({ status: 'completed', inputTokens: 100, outputTokens: 20 });
  });

  it('records failures as failures (AC 22)', async () => {
    const { ctx, cloud, agent } = await setup();
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-down'));
    await expect(runAgentPrompt(db, deps, ctx, agent.id, { prompt: 'x' })).rejects.toMatchObject({
      code: 'MODEL_CALL_FAILED',
      details: { model: ['provider_unavailable'] },
    });
    const [run] = await listAgentRuns(db, ctx, agent.id);
    expect(run).toMatchObject({ status: 'failed', error: 'provider_unavailable' });
    expect((await getDashboardSummary(db, ctx)).successRate).toBe(0);
  });

  it('activation requires a working model', async () => {
    const { ctx, cloud, agent } = await setup();
    await expect(changeAgentStatus(db, ctx, agent.id, 'activate')).rejects.toBeInstanceOf(AppError);
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-echo'));
    expect((await changeAgentStatus(db, ctx, agent.id, 'activate')).status).toBe('active');
  });
});

describe('credentials never reach prompts or logs (AC 12)', () => {
  it('keeps the API key out of the request body, run events and audit logs', async () => {
    const { ctx, cloud, agent } = await setup();
    await saveAgentModelConfig(db, ctx, agent.id, fixed(cloud.id, 'fake-echo'));
    fake.requests.length = 0;
    await runAgentPrompt(db, deps, ctx, agent.id, { prompt: 'hello' });

    const body = JSON.stringify(fake.requests.map((r) => r.body));
    expect(body).not.toContain(API_KEY);
    expect(body).toContain('Aviation Fact Checker'); // the system prompt did go out
    const stored =
      JSON.stringify(await sql`select * from run_events`) +
      JSON.stringify(await sql`select * from runs`) +
      JSON.stringify(await sql`select * from audit_logs`);
    expect(stored).not.toContain(API_KEY);
    // The key reached the provider only as an HTTP header.
    expect(fake.requests.at(-1)!.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('builds the runtime context in PRD §25 order', async () => {
    const { ctx, agent } = await setup();
    const prompt = buildSystemPrompt((await findAgent(db, ctx, agent.id))!);
    const order = [
      'AgentOS',
      '## Role',
      '## Job',
      '## Goals',
      '## Personality runtime directives',
    ].map((m) => prompt.indexOf(m));
    expect(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]!))).toBe(true);
  });
});
