// v0.6 Definition of Done: "the audit-coverage test enumerates every PRD §22 event type and
// asserts that each one produces an audit/run entry". The list is read from the PRD itself, so
// a new event type in the PRD fails this test until it is covered here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  listApprovalRequests,
  listAuditLogs,
  listRunsWithDetails,
  type AuditLog,
  type RunWithDetails,
} from '@agentos/db';
import { PRESET_TRAITS } from '@agentos/personality';
import { describe, expect, it } from 'vitest';
import {
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  updateAgentBasics,
  updatePersonality,
} from '../src/agents';
import { createMemory } from '../src/memory';
import { saveAgentModelConfig } from '../src/models';
import { decideApproval, startChatTurn } from '../src/runtime';
import { createWorkflow, saveWorkflow, startWorkflowRun } from '../src/workflows';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

/** The bullet list under "# 22. Audit & Observability → Record:" in the PRD. */
function prdAuditEvents(): string[] {
  const prd = readFileSync(
    fileURLToPath(new URL('../../../docs/AgentOS_PRD_v1.2.md', import.meta.url)),
    'utf8',
  );
  const section = prd.slice(prd.indexOf('# 22. Audit & Observability'));
  const list = section.slice(section.indexOf('Record:'), section.indexOf('Each run receives'));
  return [...list.matchAll(/^-\s+(.+?)\s*$/gm)].map((m) => m[1]!);
}

type Evidence = { audit: AuditLog[]; runs: RunWithDetails[] };
const audited = (e: Evidence, action: string) => e.audit.some((a) => a.action === action);
const events = (e: Evidence, type: string) =>
  e.runs.flatMap((r) => r.events).filter((ev) => ev.type === type);

/** PRD §22 event → where AgentOS records it. Each check must find a real entry. */
const COVERAGE: Record<string, (e: Evidence) => boolean> = {
  'agent creation/change': (e) => audited(e, 'agent.created') && audited(e, 'agent.updated'),
  'personality changes': (e) => audited(e, 'agent.personality_changed'),
  'model changes': (e) => audited(e, 'agent.model_changed'),
  'model routing': (e) =>
    events(e, 'task.classified').length > 0 &&
    events(e, 'model.selected').some((ev) => typeof ev.payload.reason === 'object'),
  'fallback events': (e) =>
    events(e, 'model.fallback').some((ev) => ev.payload.reason === 'unavailable'),
  'task delegation': (e) =>
    audited(e, 'agent.delegated') && events(e, 'delegation.started').length > 0,
  'MCP connection changes': (e) => audited(e, 'mcp.connected'),
  'tool calls': (e) =>
    audited(e, 'tool.called') &&
    e.runs.some((r) => r.toolCalls.some((t) => t.status === 'succeeded')),
  'approval decisions': (e) => audited(e, 'approval.decided'),
  'memory writes': (e) => audited(e, 'memory.created'),
  'workflow execution': (e) =>
    audited(e, 'workflow.run_started') &&
    e.audit.some((a) => a.action === 'workflow.run_finished' && a.outcome === 'success'),
  // The fake model has no published price, so the estimate is null; it is still recorded per
  // call (priced models fill it in, see models.test).
  cost: (e) => events(e, 'model.completed').every((ev) => 'costUsd' in ev.payload),
  tokens: (e) => e.runs.some((r) => (r.inputTokens ?? 0) > 0 && (r.outputTokens ?? 0) > 0),
  errors: (e) =>
    e.runs.some(
      (r) =>
        r.status === 'failed' &&
        r.error === 'provider_unavailable' &&
        r.events.some((ev) => ev.type === 'run.failed'),
    ),
};

describe('audit coverage (PRD §22, v0.6 DoD)', () => {
  it('covers exactly the event types the PRD lists', () => {
    const listed = prdAuditEvents();
    expect(listed.length).toBeGreaterThan(10);
    expect(Object.keys(COVERAGE).sort()).toEqual([...listed].sort());
  });

  it('records an audit or run entry for every PRD §22 event type', async () => {
    const s = await fx.setup(); // agent created, MCP connected, model and tools configured
    const { ctx, agent } = s;
    const target = (model: string) => ({ connectionId: s.provider.id, model });

    // A leader above the agent, so it can delegate (and the agent is changed: new parent).
    const boss = await createAgent(fx.db, ctx, {
      name: 'Lead',
      description: 'Leads the team',
      agentType: 'master_orchestrator',
      avatar: 'preset:bot',
      tags: [],
      parentAgentId: null,
      role: 'Lead',
      jobDefinition: 'Hand work to the team.',
      goals: [],
      constraints: [],
    });
    await completeAgentSetup(fx.db, ctx, boss.id);
    await saveAgentModelConfig(fx.db, ctx, boss.id, {
      strategy: 'fixed',
      primary: target('fake-echo'),
      routes: [],
      fallbacks: [],
      budget: { onExceed: 'stop' },
    });
    await changeAgentStatus(fx.db, ctx, boss.id, 'activate');
    await updateAgentBasics(fx.db, ctx, agent.id, {
      name: agent.name,
      description: agent.description,
      agentType: agent.agentType,
      avatar: agent.avatar,
      tags: agent.tags,
      parentAgentId: boss.id,
      role: agent.role,
      jobDefinition: agent.jobDefinition,
      goals: agent.goals,
      constraints: agent.constraints,
    });
    await updatePersonality(fx.db, ctx, agent.id, { traits: PRESET_TRAITS.analyst });

    // Routing with a fallback, tokens, cost estimate and a tool call.
    await saveAgentModelConfig(fx.db, ctx, agent.id, {
      strategy: 'fallback_chain',
      primary: target('fake-down'),
      routes: [],
      fallbacks: [target('fake-echo')],
      budget: { onExceed: 'stop' },
    });
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, {
      message: 'Research [[call:search:{"query":"aviation"}]]',
    });
    await fx.drain(ctx);

    // An approval decision.
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, {
      message: 'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]',
    });
    await fx.drain(ctx);
    const [approval] = await listApprovalRequests(fx.db, ctx, { status: 'pending' });
    await decideApproval(fx.db, fx.deps, ctx, approval!.id, { decision: 'approve' });
    await fx.drain(ctx);

    // Delegation from the leader.
    await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: `Go [[call:delegate:${JSON.stringify({ agent: agent.name, objective: 'Check facts' })}]]`,
    });
    await fx.drain(ctx);

    // An error: the only model is down.
    await saveAgentModelConfig(fx.db, ctx, agent.id, {
      strategy: 'fixed',
      primary: target('fake-down'),
      routes: [],
      fallbacks: [],
      budget: { onExceed: 'stop' },
    });
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, { message: 'Hello' });
    await fx.drain(ctx);

    // A memory write and a workflow run.
    await createMemory(fx.db, fx.deps, ctx, {
      type: 'semantic',
      content: 'The team prefers short answers.',
      agentId: agent.id,
    });
    const workflow = await createWorkflow(fx.db, ctx, { name: 'Audit flow' });
    await saveWorkflow(fx.db, ctx, workflow.id, {
      name: 'Audit flow',
      graph: {
        nodes: [
          {
            id: 't',
            type: 'transform',
            label: 'T',
            position: { x: 0, y: 0 },
            config: { template: '{{input}}!' },
          },
          { id: 'o', type: 'output', label: 'Out', position: { x: 0, y: 100 }, config: {} },
        ],
        edges: [{ id: 't-o', source: 't', target: 'o' }],
      },
    });
    await startWorkflowRun(fx.db, fx.deps, ctx, workflow.id, { input: 'hi', trigger: 'test' });
    await fx.drain(ctx);

    const evidence: Evidence = {
      audit: await listAuditLogs(fx.db, ctx, { limit: 1_000 }),
      runs: await listRunsWithDetails(fx.db, ctx, { limit: 100 }),
    };
    const missing = Object.entries(COVERAGE)
      .filter(([, check]) => !check(evidence))
      .map(([name]) => name);
    expect(missing).toEqual([]);

    // "Each run receives a unique run_id."
    const ids = evidence.runs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
