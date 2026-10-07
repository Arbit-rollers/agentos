export const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama', 'openai_compatible'] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

/** Connection details an adapter needs. The API key is decrypted only at the call site. */
export type ProviderAccess = {
  provider: ProviderKind;
  /** Base URL for Ollama and OpenAI-compatible endpoints; optional override otherwise. */
  endpoint?: string | null;
  apiKey?: string | null;
};

export type ToolSpec = {
  /** Provider-safe alias: [a-zA-Z_][a-zA-Z0-9_]{0,63}. */
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  /** Parsed arguments, or null when the model produced invalid JSON (see `rawArguments`). */
  arguments: Record<string, unknown> | null;
  rawArguments?: string;
};

export type ToolResultContent = {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
};

/**
 * Provider-neutral transcript. Assistant turns keep the provider's raw content so the same
 * provider gets it back unchanged (Anthropic thinking/tool_use blocks, Gemini thought
 * signatures); other providers rebuild from the neutral fields.
 */
export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      providerContent?: { provider: ProviderKind; content: unknown };
    }
  | { role: 'tool'; results: ToolResultContent[] };

export type GenerateRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  /** Sent only when the model accepts sampling parameters (see the capability registry). */
  temperature?: number;
  /** Tools the model may call; the caller decides what each call is allowed to do. */
  tools?: ToolSpec[];
  signal?: AbortSignal;
};

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

/** A model switch the provider made on its own (e.g. Anthropic server-side refusal fallback). */
export type ProviderFallback = { from: string; to: string };

export type GenerateResult = {
  text: string;
  stopReason: StopReason;
  /** The model that actually served the response. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  providerFallbacks: ProviderFallback[];
  toolCalls: ToolCall[];
  /** Raw assistant content to append to the transcript as-is. */
  providerContent: unknown;
};

export type DiscoveredModel = {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** One adapter per provider family (PRD §7.1). */
export interface ProviderAdapter {
  readonly provider: ProviderKind;
  listModels(): Promise<DiscoveredModel[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
