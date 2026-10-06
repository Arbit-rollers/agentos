import {
  findAgent,
  insertAgent,
  listAgents,
  savePersonality,
  updateAgent,
  withTransaction,
  type Agent,
  type AgentFields,
  type AgentStatus,
  type AgentType,
  type AgentWithPersonality,
  type Database,
  type Executor,
  type TenantContext,
} from '@agentos/db';
import { NEUTRAL_TRAITS, TRAITS, detectPreset, normalizeTraits } from '@agentos/personality';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';

export const AGENT_TYPES = ['master_orchestrator', 'manager', 'specialist', 'system'] as const;

/**
 * Reporting hierarchy (PRD §5.1): an agent may report only to a strictly higher-ranked type.
 * Ranks strictly decrease along every reporting line, which also rules out cycles.
 */
const RANK: Record<AgentType, number> = {
  master_orchestrator: 3,
  manager: 2,
  specialist: 1,
  system: 1,
};

const lines = (max: number) =>
  z
    .array(z.string().trim().max(300, { error: 'item_too_long' }))
    .max(max, { error: 'too_many_items' })
    .transform((items) => items.filter(Boolean));

const basicsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'agent_name_required' })
    .max(80, { error: 'agent_name_too_long' }),
  description: z
    .string()
    .trim()
    .min(1, { error: 'description_required' })
    .max(500, { error: 'description_too_long' }),
  agentType: z.enum(AGENT_TYPES, { error: 'agent_type_required' }),
  avatar: z.string().regex(/^preset:[a-z0-9_-]{1,32}$/, { error: 'invalid_avatar' }),
  tags: z
    .array(z.string().trim().min(1).max(32, { error: 'tag_too_long' }))
    .max(10, { error: 'too_many_tags' })
    // Case-insensitive de-duplication that keeps the first spelling.
    .transform((tags) =>
      tags.filter(
        (tag, index) =>
          tags.findIndex((other) => other.toLocaleLowerCase() === tag.toLocaleLowerCase()) ===
          index,
      ),
    ),
  parentAgentId: z.uuid({ error: 'invalid_parent' }).nullable(),
  role: z.string().trim().max(200, { error: 'role_too_long' }),
  jobDefinition: z.string().trim().max(4000, { error: 'job_too_long' }),
  goals: lines(20),
  constraints: lines(20),
});

export type AgentBasicsInput = z.input<typeof basicsSchema>;

/** Fields an agent needs before it leaves Draft (PRD §19: steps 1–2 are required). */
export function readinessErrors(agent: Pick<Agent, 'role' | 'jobDefinition'>) {
  const errors: Record<string, string[]> = {};
  if (!agent.role.trim()) errors.role = ['role_required'];
  if (!agent.jobDefinition.trim()) errors.jobDefinition = ['job_required'];
  return errors;
}

const isReady = (agent: Pick<Agent, 'role' | 'jobDefinition'>) =>
  Object.keys(readinessErrors(agent)).length === 0;

/**
 * Whether the agent has a usable AI model. Model configuration arrives in M4; until then no
 * agent can be activated (PRD §19: "Create & Activate" requires a valid model).
 */
export function hasModelConfiguration(_agent: Agent): boolean {
  return false;
}

async function requireAgent(db: Executor, ctx: TenantContext, id: string) {
  const agent = await findAgent(db, ctx, id);
  if (!agent) throw new AppError('NOT_FOUND', 'Agent not found');
  return agent;
}

async function assertHierarchy(
  db: Executor,
  ctx: TenantContext,
  agent: { id?: string; agentType: AgentType; parentAgentId: string | null },
) {
  if (agent.parentAgentId) {
    if (agent.parentAgentId === agent.id) {
      throw new AppError('VALIDATION', 'Invalid parent', { parentAgentId: ['invalid_parent'] });
    }
    const parent = await findAgent(db, ctx, agent.parentAgentId);
    if (!parent || parent.status === 'archived') {
      throw new AppError('VALIDATION', 'Parent not found', { parentAgentId: ['invalid_parent'] });
    }
    if (RANK[parent.agentType] <= RANK[agent.agentType]) {
      throw new AppError('VALIDATION', 'Parent must outrank child', {
        parentAgentId: ['parent_rank'],
      });
    }
  }
  if (agent.id) {
    // Changing an agent's type must not leave its direct reports outranking it.
    const children = (await listAgents(db, ctx)).filter((a) => a.parentAgentId === agent.id);
    if (children.some((child) => RANK[child.agentType] >= RANK[agent.agentType])) {
      throw new AppError('VALIDATION', 'Direct reports would outrank this agent', {
        agentType: ['children_rank'],
      });
    }
  }
}

/** Agents that `agentType` may report to (for the "Reports to" picker). */
export async function eligibleParents(
  db: Database,
  ctx: TenantContext,
  agentType: AgentType,
  selfId?: string,
): Promise<Agent[]> {
  return (await listAgents(db, ctx)).filter(
    (agent) =>
      agent.id !== selfId && agent.status !== 'archived' && RANK[agent.agentType] > RANK[agentType],
  );
}

/** Wizard step 1: creates a Draft agent with a neutral personality (PRD §19). */
export async function createAgent(
  db: Database,
  ctx: TenantContext,
  input: AgentBasicsInput,
): Promise<Agent> {
  const data = parse(basicsSchema, input);
  await assertHierarchy(db, ctx, data);
  return withTransaction(db, async (tx) => {
    const agent = await insertAgent(tx, ctx, { ...data, status: 'draft' });
    await savePersonality(tx, ctx, agent.id, {
      preset: 'custom',
      traitScores: NEUTRAL_TRAITS,
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      agentId: agent.id,
      action: 'agent.created',
      targetType: 'agent',
      targetId: agent.id,
      outcome: 'success',
      metadata: { agentType: agent.agentType },
    });
    return agent;
  });
}

export async function updateAgentBasics(
  db: Database,
  ctx: TenantContext,
  id: string,
  input: AgentBasicsInput,
): Promise<Agent> {
  const current = await requireAgent(db, ctx, id);
  if (current.status === 'archived') {
    throw new AppError('INVALID_TRANSITION', 'Restore the agent before editing it');
  }
  const data = parse(basicsSchema, input);
  await assertHierarchy(db, ctx, { ...data, id });

  // Agents past Draft must stay ready to run.
  if (current.status !== 'draft' && !isReady(data)) {
    throw new AppError('VALIDATION', 'Role and job are required', readinessErrors(data));
  }

  const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
    (key) => JSON.stringify(data[key]) !== JSON.stringify(current[key]),
  );
  const agent = await updateAgent(db, ctx, id, data);
  if (changed.length > 0) {
    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      agentId: id,
      action: 'agent.updated',
      targetType: 'agent',
      targetId: id,
      outcome: 'success',
      metadata: { fields: changed },
    });
  }
  return agent!;
}

/**
 * Saves trait scores (PRD §6). Scores are clamped to 0–100; the stored preset is the one the
 * scores still match, or `custom`. Every change bumps the version and is audited with the
 * before/after values of each changed trait (PRD §6.6, §22).
 */
export async function updatePersonality(
  db: Database,
  ctx: TenantContext,
  id: string,
  input: { traits: unknown },
): Promise<AgentWithPersonality> {
  const current = await requireAgent(db, ctx, id);
  if (current.status === 'archived') {
    throw new AppError('INVALID_TRANSITION', 'Restore the agent before editing it');
  }
  const traits = normalizeTraits(input.traits);
  const before = normalizeTraits(current.personality?.traitScores ?? NEUTRAL_TRAITS);
  const changes = Object.fromEntries(
    TRAITS.filter((trait) => before[trait] !== traits[trait]).map((trait) => [
      trait,
      [before[trait], traits[trait]],
    ]),
  );
  if (Object.keys(changes).length === 0) return current;

  const preset = detectPreset(traits);
  const personality = await savePersonality(db, ctx, id, { preset, traitScores: traits });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: id,
    action: 'agent.personality_changed',
    targetType: 'agent',
    targetId: id,
    outcome: 'success',
    metadata: { version: personality!.version, preset, changes },
  });
  return { ...current, personality: personality! };
}

/** Wizard "Create agent": Draft → Configured once role and job are filled in. */
export async function completeAgentSetup(
  db: Database,
  ctx: TenantContext,
  id: string,
): Promise<Agent> {
  const agent = await requireAgent(db, ctx, id);
  if (agent.status !== 'draft') return agent;
  const errors = readinessErrors(agent);
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION', 'Agent is not ready', errors);
  }
  return setStatus(db, ctx, agent, 'configured');
}

export type AgentAction = 'activate' | 'pause' | 'resume' | 'archive' | 'restore';

/** Lifecycle (PRD §5.2): Draft → Configured → Active ⇄ Paused, any → Archived → restore. */
export function allowedActions(agent: Agent): AgentAction[] {
  switch (agent.status) {
    case 'draft':
      return ['archive'];
    case 'configured':
      return ['activate', 'archive'];
    case 'active':
      return ['pause', 'archive'];
    case 'paused':
      return ['resume', 'archive'];
    case 'archived':
      return ['restore'];
  }
}

export async function changeAgentStatus(
  db: Database,
  ctx: TenantContext,
  id: string,
  action: AgentAction,
): Promise<Agent> {
  const agent = await requireAgent(db, ctx, id);
  if (!allowedActions(agent).includes(action)) {
    throw new AppError('INVALID_TRANSITION', `Cannot ${action} a ${agent.status} agent`);
  }
  if ((action === 'activate' || action === 'resume') && !hasModelConfiguration(agent)) {
    throw new AppError('MODEL_REQUIRED', 'Choose an AI model before activating this agent');
  }
  const target: Record<AgentAction, AgentStatus> = {
    activate: 'active',
    pause: 'paused',
    resume: 'active',
    archive: 'archived',
    restore: isReady(agent) ? 'configured' : 'draft',
  };
  return setStatus(db, ctx, agent, target[action]);
}

async function setStatus(db: Database, ctx: TenantContext, agent: Agent, status: AgentStatus) {
  const updated = await updateAgent(db, ctx, agent.id, { status } satisfies AgentFields);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: agent.id,
    action: 'agent.status_changed',
    targetType: 'agent',
    targetId: agent.id,
    outcome: 'success',
    metadata: { from: agent.status, to: status },
  });
  return updated!;
}
