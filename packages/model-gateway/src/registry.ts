import type { DiscoveredModel, ProviderKind } from './types';

/** What a model can do and cost (PRD §7.5). Unknown values stay undefined, never guessed. */
export type ModelCapabilities = {
  vision: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  /** Accepts sampling parameters such as temperature. */
  sampling: boolean;
  local: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** USD per million tokens. */
  pricing?: { input: number; output: number };
};

type Seed = Omit<ModelCapabilities, 'local'>;

const claude = (input: number, output: number, contextWindow: number, sampling = false): Seed => ({
  vision: true,
  toolCalling: true,
  structuredOutput: true,
  reasoning: true,
  sampling,
  contextWindow,
  maxOutputTokens: contextWindow >= 1_000_000 ? 128_000 : 64_000,
  pricing: { input, output },
});

/**
 * Known metadata, keyed by provider then model id. Anthropic prices and limits come from
 * Anthropic's published model table (cached 2026-09-25). Other providers' models are
 * discovered from their model list and start with unknown pricing; cost then shows as
 * unknown rather than as a made-up number.
 */
const SEED: Partial<Record<ProviderKind, Record<string, Seed>>> = {
  anthropic: {
    'claude-fable-5-1': claude(10, 50, 1_000_000),
    'claude-fable-5': claude(10, 50, 1_000_000),
    'claude-opus-5-5': claude(4, 20, 1_000_000),
    'claude-opus-5': claude(5, 25, 1_000_000),
    'claude-opus-4-8': claude(5, 25, 1_000_000),
    'claude-sonnet-5-5': claude(2, 10, 1_000_000),
    'claude-sonnet-5': claude(2, 10, 1_000_000),
    'claude-haiku-4-5': claude(1, 5, 200_000, true),
  },
};

export function describeModel(
  provider: ProviderKind,
  modelId: string,
  discovered?: DiscoveredModel,
): ModelCapabilities {
  const local = provider === 'ollama';
  const seed = SEED[provider]?.[modelId];
  if (seed) return { ...seed, local };
  return {
    vision: false,
    toolCalling: provider !== 'ollama' && provider !== 'openai_compatible',
    structuredOutput: provider !== 'ollama' && provider !== 'openai_compatible',
    reasoning: false,
    sampling: provider !== 'anthropic',
    local,
    contextWindow: discovered?.contextWindow,
    maxOutputTokens: discovered?.maxOutputTokens,
  };
}

/** Rough pre-call estimate (≈4 characters per token) for context and budget checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimated USD cost, or null when the model's pricing is unknown (e.g. local models are 0). */
export function estimateCost(
  capabilities: ModelCapabilities,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  if (capabilities.local) return 0;
  if (!capabilities.pricing) return null;
  return (
    (usage.inputTokens * capabilities.pricing.input +
      usage.outputTokens * capabilities.pricing.output) /
    1_000_000
  );
}
