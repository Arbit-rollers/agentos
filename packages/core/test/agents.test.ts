import { listAuditLogs, listAgents } from '@agentos/db';
import { PRESET_TRAITS, compilePersonality } from '@agentos/personality';
import { describe, expect, it } from 'vitest';
import {
  allowedActions,
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  eligibleParents,
  updateAgentBasics,
  updatePersonality,
  type AgentBasicsInput,
} from '../src/agents';
import { getDashboardSummary } from '../src/dashboard';
import type { AppError } from '../src/errors';
import { createUser, useTestDb } from './helpers';

const { db } = useTestDb();

const basics = (overrides: Partial<AgentBasicsInput> = {}): AgentBasicsInput => ({
  name: 'Fact Checker',
  description: 'Verifies aviation facts',
  agentType: 'specialist',
  avatar: 'preset:plane',
  tags: ['Aviation', 'aviation', ' Content '],
  parentAgentId: null,
  role: 'Aviation Fact Checker',
  jobDefinition: 'Check every claim in scripts against authoritative sources.',
  goals: ['Zero factual errors', ''],
  constraints: [],
  ...overrides,
});

const rejectsWith = (code: AppError['code'], details?: Record<string, string[]>) =>
  expect.objectContaining({ code, ...(details && { details: expect.objectContaining(details) }) });

describe('createAgent', () => {
  it('creates a Draft agent with a neutral personality and audits it (AC 3)', async () => {
    const { ctx } = await createUser(db);
    const first = await createAgent(db, ctx, basics());
    await createAgent(db, ctx, basics({ name: 'Researcher' }));

    expect(first).toMatchObject({
      status: 'draft',
      tags: ['Aviation', 'Content'],
      goals: ['Zero factual errors'],
    });
    expect(await listAgents(db, ctx)).toHaveLength(2);
    const actions = (await listAuditLogs(db, ctx)).map((log) => log.action);
    expect(actions.filter((a) => a === 'agent.created')).toHaveLength(2);
  });

  it('validates required fields with translatable codes', async () => {
    const { ctx } = await createUser(db);
    await expect(
      createAgent(db, ctx, basics({ name: ' ', description: '', avatar: 'javascript:alert(1)' })),
    ).rejects.toEqual(
      rejectsWith('VALIDATION', {
        name: ['agent_name_required'],
        description: ['description_required'],
        avatar: ['invalid_avatar'],
      }),
    );
  });
});

describe('hierarchy (PRD §5.1)', () => {
  it('only allows reporting to a higher-ranked type', async () => {
    const { ctx } = await createUser(db);
    const master = await createAgent(
      db,
      ctx,
      basics({ name: 'Master', agentType: 'master_orchestrator' }),
    );
    const manager = await createAgent(
      db,
      ctx,
      basics({ name: 'Manager', agentType: 'manager', parentAgentId: master.id }),
    );
    const specialist = await createAgent(db, ctx, basics({ parentAgentId: manager.id }));
    expect(specialist.parentAgentId).toBe(manager.id);

    await expect(
      createAgent(
        db,
        ctx,
        basics({ name: 'Bad', agentType: 'manager', parentAgentId: specialist.id }),
      ),
    ).rejects.toEqual(rejectsWith('VALIDATION', { parentAgentId: ['parent_rank'] }));

    // Demoting the manager would leave the specialist outranking or equal to it.
    await expect(
      updateAgentBasics(
        db,
        ctx,
        manager.id,
        basics({ name: 'Manager', agentType: 'specialist', parentAgentId: master.id }),
      ),
    ).rejects.toEqual(rejectsWith('VALIDATION', { agentType: ['children_rank'] }));

    const names = (await eligibleParents(db, ctx, 'specialist')).map((a) => a.name).sort();
    expect(names).toEqual(['Manager', 'Master']);
    expect((await eligibleParents(db, ctx, 'master_orchestrator')).length).toBe(0);
  });

  it('cannot report to itself or to an agent in another workspace', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const bobsMaster = await createAgent(db, bob.ctx, basics({ agentType: 'master_orchestrator' }));
    await expect(
      createAgent(db, alice.ctx, basics({ parentAgentId: bobsMaster.id })),
    ).rejects.toEqual(rejectsWith('VALIDATION', { parentAgentId: ['invalid_parent'] }));

    const manager = await createAgent(db, alice.ctx, basics({ agentType: 'manager' }));
    await expect(
      updateAgentBasics(
        db,
        alice.ctx,
        manager.id,
        basics({ agentType: 'manager', parentAgentId: manager.id }),
      ),
    ).rejects.toEqual(rejectsWith('VALIDATION', { parentAgentId: ['invalid_parent'] }));
  });
});

describe('personality', () => {
  it('stores bounded scores, detects presets, versions and audits changes (AC 4)', async () => {
    const { ctx } = await createUser(db);
    const agent = await createAgent(db, ctx, basics());

    const analyst = await updatePersonality(db, ctx, agent.id, { traits: PRESET_TRAITS.analyst });
    expect(analyst.personality).toMatchObject({ preset: 'analyst', version: 2 });

    const edited = await updatePersonality(db, ctx, agent.id, {
      traits: { ...PRESET_TRAITS.analyst, concise: 500, humorous: -3 },
    });
    expect(edited.personality).toMatchObject({ preset: 'custom', version: 3 });
    expect(edited.personality?.traitScores).toMatchObject({ concise: 100, humorous: 0 });

    const log = (await listAuditLogs(db, ctx)).find(
      (l) => l.action === 'agent.personality_changed',
    );
    expect(log?.metadata).toMatchObject({
      version: 3,
      preset: 'custom',
      changes: { concise: [40, 100], humorous: [20, 0] },
    });

    // No-op saves don't bump the version or write audit noise.
    const same = await updatePersonality(db, ctx, agent.id, {
      traits: edited.personality!.traitScores,
    });
    expect(same.personality?.version).toBe(3);
  });

  it('two agents with the same role compile to different directives (AC 4, 5)', async () => {
    const { ctx } = await createUser(db);
    const a = await createAgent(db, ctx, basics({ name: 'A' }));
    const b = await createAgent(db, ctx, basics({ name: 'B' }));
    const pa = await updatePersonality(db, ctx, a.id, { traits: PRESET_TRAITS.skeptical_reviewer });
    const pb = await updatePersonality(db, ctx, b.id, { traits: PRESET_TRAITS.creative_director });
    const directives = (p: typeof pa) =>
      compilePersonality(p.personality?.traitScores).directives.map((d) => d.id);
    expect(directives(pa)).not.toEqual(directives(pb));
  });
});

describe('lifecycle (PRD §5.2)', () => {
  it('Draft → Configured requires role and job', async () => {
    const { ctx } = await createUser(db);
    const incomplete = await createAgent(db, ctx, basics({ role: '', jobDefinition: '' }));
    await expect(completeAgentSetup(db, ctx, incomplete.id)).rejects.toEqual(
      rejectsWith('VALIDATION', { role: ['role_required'], jobDefinition: ['job_required'] }),
    );
    const ready = await createAgent(db, ctx, basics());
    expect((await completeAgentSetup(db, ctx, ready.id)).status).toBe('configured');
  });

  it('cannot activate without a model (arrives in M4)', async () => {
    const { ctx } = await createUser(db);
    const agent = await completeAgentSetup(db, ctx, (await createAgent(db, ctx, basics())).id);
    expect(allowedActions(agent)).toEqual(['activate', 'archive']);
    await expect(changeAgentStatus(db, ctx, agent.id, 'activate')).rejects.toEqual(
      rejectsWith('MODEL_REQUIRED'),
    );
  });

  it('archives, blocks edits while archived, and restores', async () => {
    const { ctx } = await createUser(db);
    const agent = await completeAgentSetup(db, ctx, (await createAgent(db, ctx, basics())).id);
    const archived = await changeAgentStatus(db, ctx, agent.id, 'archive');
    expect(archived.status).toBe('archived');
    await expect(updateAgentBasics(db, ctx, agent.id, basics())).rejects.toEqual(
      rejectsWith('INVALID_TRANSITION'),
    );
    await expect(changeAgentStatus(db, ctx, agent.id, 'pause')).rejects.toEqual(
      rejectsWith('INVALID_TRANSITION'),
    );
    expect((await changeAgentStatus(db, ctx, agent.id, 'restore')).status).toBe('configured');

    const log = (await listAuditLogs(db, ctx)).filter((l) => l.action === 'agent.status_changed');
    expect(log.map((l) => l.metadata)).toContainEqual({ from: 'configured', to: 'archived' });
  });

  it('configured agents must stay ready', async () => {
    const { ctx } = await createUser(db);
    const agent = await completeAgentSetup(db, ctx, (await createAgent(db, ctx, basics())).id);
    await expect(updateAgentBasics(db, ctx, agent.id, basics({ role: '' }))).rejects.toEqual(
      rejectsWith('VALIDATION', { role: ['role_required'] }),
    );
  });
});

describe('tenant isolation (AC 2)', () => {
  it('another workspace cannot read, edit, retune or archive an agent', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const agent = await createAgent(db, bob.ctx, basics());
    const notFound = rejectsWith('NOT_FOUND');

    expect(await listAgents(db, alice.ctx)).toEqual([]);
    await expect(updateAgentBasics(db, alice.ctx, agent.id, basics())).rejects.toEqual(notFound);
    await expect(updatePersonality(db, alice.ctx, agent.id, { traits: {} })).rejects.toEqual(
      notFound,
    );
    await expect(changeAgentStatus(db, alice.ctx, agent.id, 'archive')).rejects.toEqual(notFound);
    await expect(completeAgentSetup(db, alice.ctx, agent.id)).rejects.toEqual(notFound);
    expect((await listAgents(db, bob.ctx))[0]?.status).toBe('draft');
  });
});

describe('dashboard', () => {
  it('counts agents and lists non-archived ones', async () => {
    const { ctx } = await createUser(db);
    const a = await createAgent(db, ctx, basics({ name: 'A' }));
    await createAgent(db, ctx, basics({ name: 'B' }));
    await changeAgentStatus(db, ctx, a.id, 'archive');
    const summary = await getDashboardSummary(db, ctx);
    expect(summary.agents).toEqual({ active: 0, paused: 0, total: 1 });
    expect(summary.agentList.map((agent) => agent.name)).toEqual(['B']);
  });
});
