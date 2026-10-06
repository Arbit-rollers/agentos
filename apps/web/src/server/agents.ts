import 'server-only';
import { notFound } from 'next/navigation';
import { AGENT_TYPES, eligibleParents } from '@agentos/core';
import { findAgent, type AgentType, type TenantContext } from '@agentos/db';
import { isUuid } from './api';
import { getServices } from './services';

/** Loads an agent in the caller's workspace, or renders the 404 page (AC 2). */
export async function loadAgentOr404(ctx: TenantContext, id: string) {
  const agent = isUuid(id) ? await findAgent(getServices().db, ctx, id) : undefined;
  if (!agent) notFound();
  return agent;
}

/** "Reports to" options for every agent type, so the form can switch types client-side. */
export async function parentOptionsByType(ctx: TenantContext, selfId?: string) {
  const db = getServices().db;
  const entries = await Promise.all(
    AGENT_TYPES.map(async (type) => {
      const parents = await eligibleParents(db, ctx, type, selfId);
      return [type, parents.map(({ id, name }) => ({ id, name }))] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<AgentType, { id: string; name: string }[]>;
}
