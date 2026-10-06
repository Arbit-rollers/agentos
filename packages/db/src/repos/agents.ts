import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { agentPersonalities, agents } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type Agent = typeof agents.$inferSelect;
export type AgentStatus = Agent['status'];
export type AgentType = Agent['agentType'];
export type AgentPersonality = typeof agentPersonalities.$inferSelect;
export type AgentWithPersonality = Agent & { personality: AgentPersonality | null };

/** Fields the agent service may write; ids, owner and timestamps are set here. */
export type AgentFields = Partial<
  Pick<
    Agent,
    | 'parentAgentId'
    | 'agentType'
    | 'name'
    | 'description'
    | 'avatar'
    | 'tags'
    | 'role'
    | 'jobDefinition'
    | 'goals'
    | 'constraints'
    | 'status'
    | 'approvalPolicy'
  >
>;

export async function insertAgent(
  db: Executor,
  ctx: TenantContext,
  values: AgentFields & Pick<Agent, 'agentType' | 'name'>,
): Promise<Agent> {
  const [agent] = await db
    .insert(agents)
    .values({ ...values, workspaceId: ctx.workspaceId, ownerUserId: ctx.userId })
    .returning();
  return agent!;
}

export async function findAgent(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<AgentWithPersonality | undefined> {
  const [row] = await db
    .select({ agent: agents, personality: agentPersonalities })
    .from(agents)
    .leftJoin(agentPersonalities, eq(agentPersonalities.agentId, agents.id))
    .where(tenantScope(ctx, agents, eq(agents.id, id)))
    .limit(1);
  return row && { ...row.agent, personality: row.personality };
}

export async function listAgents(
  db: Executor,
  ctx: TenantContext,
  options: { statuses?: AgentStatus[] } = {},
): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(
      tenantScope(
        ctx,
        agents,
        options.statuses?.length ? inArray(agents.status, options.statuses) : undefined,
      ),
    )
    .orderBy(asc(agents.name), asc(agents.createdAt));
}

export async function countAgentsByStatus(
  db: Executor,
  ctx: TenantContext,
): Promise<Record<AgentStatus, number>> {
  const rows = await db
    .select({ status: agents.status, count: sql<number>`count(*)::int` })
    .from(agents)
    .where(tenantScope(ctx, agents))
    .groupBy(agents.status);
  const counts: Record<AgentStatus, number> = {
    draft: 0,
    configured: 0,
    active: 0,
    paused: 0,
    archived: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

export async function listChildAgents(
  db: Executor,
  ctx: TenantContext,
  parentAgentId: string,
): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(tenantScope(ctx, agents, eq(agents.parentAgentId, parentAgentId)))
    .orderBy(asc(agents.name));
}

export async function updateAgent(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: AgentFields,
): Promise<Agent | undefined> {
  const [agent] = await db
    .update(agents)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, agents, eq(agents.id, id)))
    .returning();
  return agent;
}

/**
 * Creates or replaces the agent's personality, incrementing its version. Returns undefined
 * when the agent isn't in the caller's workspace (personality rows carry no workspace id,
 * so ownership is checked through the agent).
 */
export async function savePersonality(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  values: { preset: string; traitScores: Record<string, number> },
): Promise<AgentPersonality | undefined> {
  const [owned] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(tenantScope(ctx, agents, eq(agents.id, agentId)))
    .limit(1);
  if (!owned) return undefined;

  const [row] = await db
    .insert(agentPersonalities)
    .values({ agentId, ...values })
    .onConflictDoUpdate({
      target: agentPersonalities.agentId,
      set: {
        ...values,
        version: sql`${agentPersonalities.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}
