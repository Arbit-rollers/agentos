import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, errorKindForStatus } from '../errors';
import type {
  ChatMessage,
  DiscoveredModel,
  GenerateRequest,
  GenerateResult,
  ProviderAccess,
  ProviderAdapter,
  ProviderFallback,
  StopReason,
  ToolCall,
} from '../types';

const TIMEOUT_MS = 120_000;
/** Non-streaming default from Anthropic's guidance: room to answer, under HTTP timeouts. */
const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Models that support server-side refusal fallback. On a policy decline the API re-runs the
 * request on a fallback model it picks by refusal category; we record any switch it makes
 * as a provider fallback, so nothing changes model silently (PRD §7.2).
 */
const SERVER_FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

function toProviderError(error: unknown): unknown {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'Provider request timed out');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('unavailable', 'Could not reach the provider');
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      errorKindForStatus(error.status),
      `Provider returned HTTP ${error.status ?? 'error'}`,
      error.status,
    );
  }
  return error;
}

const STOP: Record<string, StopReason> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

type Block = { type: string; [key: string]: unknown };

/**
 * Prepares a response's content for echoing in the next turn (Anthropic's fallback rules):
 * before the last `fallback` marker, drop thinking/redacted_thinking/tool_use blocks (the
 * declined partial), keep text; the marker itself is dropped; everything after echoes as-is.
 */
export function echoableContent(content: Block[]): Block[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary === -1) return content;
  const before = content
    .slice(0, boundary)
    .filter(
      (b) =>
        !['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use', 'fallback'].includes(
          b.type,
        ),
    );
  return [...before, ...content.slice(boundary + 1)];
}

/**
 * Builds Anthropic messages from the neutral transcript. Assistant turns produced by
 * Anthropic are sent back unchanged (thinking and tool_use blocks included, as the API
 * requires in a tool loop); all results of one turn go in a single user message.
 */
function toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === 'user') return { role: 'user', content: message.content };
    if (message.role === 'assistant') {
      if (message.providerContent?.provider === 'anthropic') {
        return {
          role: 'assistant',
          content: message.providerContent.content as Anthropic.ContentBlockParam[],
        };
      }
      return {
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          })),
        ],
      };
    }
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.toolCallId,
        content: result.content,
        ...(result.isError && { is_error: true }),
      })),
    };
  });
}

function fromContent(content: Block[]) {
  let text = '';
  const toolCalls: ToolCall[] = [];
  const providerFallbacks: ProviderFallback[] = [];
  for (const block of content) {
    if (block.type === 'text') text += block.text as string;
    if (block.type === 'tool_use') {
      const input = block.input;
      toolCalls.push({
        id: block.id as string,
        name: block.name as string,
        arguments:
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : null,
      });
    }
    if (block.type === 'fallback') {
      const { from, to } = block as unknown as { from: { model: string }; to: { model: string } };
      providerFallbacks.push({ from: from.model, to: to.model });
    }
  }
  return { text, toolCalls, providerFallbacks };
}

export function createAnthropicAdapter(access: ProviderAccess): ProviderAdapter {
  const client = new Anthropic({
    apiKey: access.apiKey ?? undefined,
    baseURL: access.endpoint || undefined,
    maxRetries: 1,
    timeout: TIMEOUT_MS,
  });

  return {
    provider: 'anthropic',

    async listModels(): Promise<DiscoveredModel[]> {
      try {
        const models: DiscoveredModel[] = [];
        for await (const model of client.models.list()) {
          models.push({
            id: model.id,
            displayName: model.display_name,
            contextWindow: model.max_input_tokens ?? undefined,
            maxOutputTokens: model.max_tokens ?? undefined,
          });
        }
        return models;
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const params = {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system && { system: request.system }),
        messages: toMessages(request.messages),
        // Current Claude models reject sampling parameters; the registry only lets
        // temperature through for models that accept it.
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        // tool_choice stays at the default (auto): forced tool use is rejected by current models.
        ...(request.tools?.length && {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          })),
        }),
      };
      try {
        const response = SERVER_FALLBACK_MODELS.has(request.model)
          ? await client.beta.messages.create(
              {
                ...params,
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
              } as never,
              { signal: request.signal },
            )
          : await client.messages.create(params, { signal: request.signal });
        const content = response.content as unknown as Block[];
        const { text, toolCalls, providerFallbacks } = fromContent(content);
        return {
          text,
          stopReason: STOP[response.stop_reason ?? ''] ?? 'other',
          model: response.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          providerFallbacks,
          toolCalls,
          providerContent: echoableContent(content),
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
