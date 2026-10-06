import type { ProviderKind } from './types';

export const STRATEGIES = ['fixed', 'smart_router', 'fallback_chain'] as const;
export type ModelStrategy = (typeof STRATEGIES)[number];

/** Task categories the Smart Router can route on (PRD §7.2 B). */
export const TASK_CATEGORIES = [
  'general',
  'research',
  'reasoning',
  'fast',
  'private',
  'vision',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type ModelTarget = { connectionId: string; provider: ProviderKind; model: string };

export type ModelPlan = {
  strategy: ModelStrategy;
  primary: ModelTarget;
  routes: { category: TaskCategory; target: ModelTarget }[];
  fallbacks: ModelTarget[];
};

export type RoutingReason =
  | { code: 'fixed' }
  | { code: 'fallback_chain' }
  | { code: 'route'; category: TaskCategory }
  | { code: 'default_route'; category: TaskCategory };

const same = (a: ModelTarget, b: ModelTarget) =>
  a.connectionId === b.connectionId && a.model === b.model;

/**
 * Ordered candidates for one call, plus why the first one was chosen. Deterministic, so the
 * recorded reason always explains the choice.
 */
export function planCandidates(
  plan: ModelPlan,
  category: TaskCategory,
): { candidates: ModelTarget[]; reason: RoutingReason } {
  const withFallbacks = (first: ModelTarget) => [
    first,
    ...plan.fallbacks.filter((target) => !same(target, first)),
  ];
  switch (plan.strategy) {
    case 'fixed':
      return { candidates: [plan.primary], reason: { code: 'fixed' } };
    case 'fallback_chain':
      return { candidates: withFallbacks(plan.primary), reason: { code: 'fallback_chain' } };
    case 'smart_router': {
      const route = plan.routes.find((r) => r.category === category);
      return route
        ? { candidates: withFallbacks(route.target), reason: { code: 'route', category } }
        : { candidates: withFallbacks(plan.primary), reason: { code: 'default_route', category } };
    }
  }
}
