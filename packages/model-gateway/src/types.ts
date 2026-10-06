export const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama', 'openai_compatible'] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

/** Connection details an adapter needs. The API key is decrypted only at the call site. */
export type ProviderAccess = {
  provider: ProviderKind;
  /** Base URL for Ollama and OpenAI-compatible endpoints; optional override otherwise. */
  endpoint?: string | null;
  apiKey?: string | null;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type GenerateRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  /** Sent only when the model accepts sampling parameters (see the capability registry). */
  temperature?: number;
  signal?: AbortSignal;
};

export type StopReason = 'end' | 'max_tokens' | 'refusal' | 'other';

/** A model switch the provider made on its own (e.g. Anthropic server-side refusal fallback). */
export type ProviderFallback = { from: string; to: string };

export type GenerateResult = {
  text: string;
  stopReason: StopReason;
  /** The model that actually served the response. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  providerFallbacks: ProviderFallback[];
};

export type DiscoveredModel = {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/**
 * One adapter per provider family (PRD §7.1). Streaming and tool calling are added with the
 * agent runtime (M6).
 */
export interface ProviderAdapter {
  readonly provider: ProviderKind;
  listModels(): Promise<DiscoveredModel[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
