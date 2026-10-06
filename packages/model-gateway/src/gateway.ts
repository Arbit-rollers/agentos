import { FALLBACK_KINDS, ProviderError, type ProviderErrorKind } from './errors';
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

/** Everything the gateway decides is reported as an event; nothing switches silently (PRD §7.2). */
export type GatewayEvent =
  | { type: 'model.selected'; target: ModelTarget; reason: RoutingReason }
  | { type: 'model.skipped'; target: ModelTarget; reason: SkipReason }
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
  const promptTokens = estimateTokens(
    [input.request.system ?? '', ...input.request.messages.map((m) => m.content)].join('\n'),
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
  const { candidates, reason } = planCandidates(input.plan, input.category);
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
      if (error instanceof ProviderError && FALLBACK_KINDS.has(error.kind) && !isLast) {
        await deps.onEvent({
          type: 'model.fallback',
          from: target,
          reason: error.kind,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  throw new NoEligibleModelError(skipped);
}
