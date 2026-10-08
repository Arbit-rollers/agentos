import { FALLBACK_KINDS, ProviderError, type ProviderErrorKind } from './errors';
import type { ModelHealth } from './health';
import { estimateCost, estimateTokens, type ModelCapabilities } from './registry';
import {
  planCandidates,
  type ModelPlan,
  type ModelTarget,
  type RoutingReason,
  type TaskCategory,
} from './router';
import type { GenerateRequest, GenerateResult, ProviderAdapter, ProviderFallback } from './types';

export type SkipReason = 'unsupported_modality' | 'context_limit' | 'cost_threshold';
/** A model kept failing recently; it is tried only after the healthy candidates. */
export type DeferReason = 'circuit_open';

/** Everything the gateway decides is reported as an event; nothing switches silently (PRD §7.2). */
export type GatewayEvent =
  | { type: 'model.selected'; target: ModelTarget; reason: RoutingReason }
  | { type: 'model.skipped'; target: ModelTarget; reason: SkipReason }
  | { type: 'model.deferred'; target: ModelTarget; reason: DeferReason }
  | { type: 'model.fallback'; from: ModelTarget; reason: ProviderErrorKind; message: string }
  | { type: 'model.provider_fallback'; target: ModelTarget; fallback: ProviderFallback }
  | {
      type: 'model.completed';
      target: ModelTarget;
      servedBy: string;
      usage: GenerateResult['usage'];
      costUsd: number | null;
    };

export type InvokeDeps = {
  adapterFor(target: ModelTarget): Promise<ProviderAdapter>;
  capabilitiesFor(target: ModelTarget): ModelCapabilities;
  onEvent(event: GatewayEvent): void | Promise<void>;
  /** Shared failure memory across calls (circuit breaker); optional. */
  health?: ModelHealth;
};

export type InvokeInput = {
  plan: ModelPlan;
  category: TaskCategory;
  request: Omit<GenerateRequest, 'model'>;
  /** Skip candidates whose estimated cost for this call exceeds the limit (PRD §7.2 C). */
  maxCostUsd?: number;
};

export type InvokeResult = {
  result: GenerateResult;
  target: ModelTarget;
  reason: RoutingReason;
  costUsd: number | null;
};

export class NoEligibleModelError extends Error {
  constructor(readonly skipped: { target: ModelTarget; reason: SkipReason }[]) {
    super('No configured model can handle this request');
    this.name = 'NoEligibleModelError';
  }
}

function skipReason(input: InvokeInput, capabilities: ModelCapabilities): SkipReason | undefined {
  if (input.category === 'vision' && !capabilities.vision) return 'unsupported_modality';
  if (input.category === 'private' && !capabilities.local) return 'unsupported_modality';
  if (input.request.tools?.length && !capabilities.toolCalling) return 'unsupported_modality';
  const promptTokens = estimateTokens(
    [
      input.request.system ?? '',
      JSON.stringify(input.request.tools ?? []),
      ...input.request.messages.map((m) =>
        m.role === 'tool' ? JSON.stringify(m.results) : m.content,
      ),
    ].join('\n'),
  );
  if (capabilities.contextWindow && promptTokens > capabilities.contextWindow) {
    return 'context_limit';
  }
  if (input.maxCostUsd !== undefined) {
    const estimate = estimateCost(capabilities, {
      inputTokens: promptTokens,
      outputTokens: input.request.maxOutputTokens ?? 1_000,
    });
    if (estimate !== null && estimate > input.maxCostUsd) return 'cost_threshold';
  }
  return undefined;
}

/**
 * Runs one model call under the agent's strategy: picks candidates, skips ones that can't
 * serve the request, and falls back on outages, rate limits and timeouts. Configuration
 * errors (bad key, unknown model) surface immediately instead of hiding behind a fallback.
 */
export async function invokeModel(input: InvokeInput, deps: InvokeDeps): Promise<InvokeResult> {
  const planned = planCandidates(input.plan, input.category);
  const { reason } = planned;
  // Models that keep failing go to the back of the line while they cool down, so a call doesn't
  // wait on an outage it already knows about. They stay as a last resort.
  const open = deps.health
    ? planned.candidates.filter((target) => deps.health!.isOpen(target))
    : [];
  const healthy = planned.candidates.filter((target) => !open.includes(target));
  if (healthy.length > 0) {
    for (const target of open) {
      await deps.onEvent({ type: 'model.deferred', target, reason: 'circuit_open' });
    }
  }
  const candidates = healthy.length > 0 ? [...healthy, ...open] : planned.candidates;
  const skipped: { target: ModelTarget; reason: SkipReason }[] = [];
  let selectedOnce = false;

  for (const [index, target] of candidates.entries()) {
    const capabilities = deps.capabilitiesFor(target);
    const skip = skipReason(input, capabilities);
    if (skip) {
      skipped.push({ target, reason: skip });
      await deps.onEvent({ type: 'model.skipped', target, reason: skip });
      continue;
    }

    if (!selectedOnce) {
      await deps.onEvent({ type: 'model.selected', target, reason });
      selectedOnce = true;
    }

    try {
      const adapter = await deps.adapterFor(target);
      const { temperature, ...request } = input.request;
      const result = await adapter.generate({
        ...request,
        model: target.model,
        ...(capabilities.sampling && temperature !== undefined && { temperature }),
      });
      for (const fallback of result.providerFallbacks) {
        await deps.onEvent({ type: 'model.provider_fallback', target, fallback });
      }
      deps.health?.recordSuccess(target);
      const costUsd = estimateCost(capabilities, result.usage);
      await deps.onEvent({
        type: 'model.completed',
        target,
        servedBy: result.model,
        usage: result.usage,
        costUsd,
      });
      return { result, target, reason, costUsd };
    } catch (error) {
      const isLast = index === candidates.length - 1;
      const transient = error instanceof ProviderError && FALLBACK_KINDS.has(error.kind);
      if (transient) deps.health?.recordFailure(target);
      if (transient && !isLast) {
        await deps.onEvent({
          type: 'model.fallback',
          from: target,
          reason: (error as ProviderError).kind,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  throw new NoEligibleModelError(skipped);
}
