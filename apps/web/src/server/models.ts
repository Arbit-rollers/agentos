import 'server-only';
import { findModelConfig, listProviderConnections, type TenantContext } from '@agentos/db';
import { describeModel } from '@agentos/model-gateway';
import type { BrainConnectionOption, BrainValue } from '@/components/agents/brain-types';
import { getServices } from './services';

/** Providers and their models, with the capability facts the editor needs (PRD §7.5). */
export async function brainOptions(ctx: TenantContext): Promise<BrainConnectionOption[]> {
  const connections = await listProviderConnections(getServices().db, ctx);
  return connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    connected: connection.status === 'connected',
    models: connection.models.map((model) => {
      const capabilities = describeModel(connection.provider, model.id, model);
      return {
        id: model.id,
        label:
          model.displayName && model.displayName !== model.id
            ? `${model.displayName} (${model.id})`
            : model.id,
        sampling: capabilities.sampling,
        local: capabilities.local,
        ...(capabilities.pricing && { price: capabilities.pricing }),
      };
    }),
  }));
}

export async function brainValue(ctx: TenantContext, agentId: string): Promise<BrainValue | null> {
  const config = await findModelConfig(getServices().db, ctx, agentId);
  if (!config) return null;
  return {
    strategy: config.strategy,
    primary: { connectionId: config.primaryConnectionId, model: config.primaryModel },
    routes: config.routes.map((r) => ({
      category: r.taskCategory,
      connectionId: r.connectionId,
      model: r.model,
    })),
    fallbacks: config.fallbacks,
    temperature: config.parameters.temperature,
    maxOutputTokens: config.parameters.maxOutputTokens,
    budget: config.budgetPolicy,
  };
}
