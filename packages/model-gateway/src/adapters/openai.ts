import OpenAI from 'openai';
import { ProviderError, checkDimensions, errorKindForStatus } from '../errors';
import type {
  ChatMessage,
  DiscoveredModel,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  ProviderAccess,
  ProviderAdapter,
  StopReason,
  ToolCall,
} from '../types';
import { EMBEDDING_DIMENSIONS } from '../types';

const TIMEOUT_MS = 120_000;

function toProviderError(error: unknown): unknown {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'Provider request timed out');
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError('unavailable', 'Could not reach the provider');
  }
  if (error instanceof OpenAI.APIError) {
    return new ProviderError(
      errorKindForStatus(error.status),
      `Provider returned HTTP ${error.status ?? 'error'}`,
      error.status,
    );
  }
  return error;
}

const STOP: Record<string, StopReason> = {
  stop: 'end',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toMessages(system: string | undefined, messages: ChatMessage[]): Message[] {
  const out: Message[] = system ? [{ role: 'system', content: system }] : [];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length && {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: call.rawArguments ?? JSON.stringify(call.arguments ?? {}),
            },
          })),
        }),
      });
    } else {
      // Chat Completions has no error flag on tool messages; the text says so instead.
      for (const result of message.results) {
        out.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.isError ? `Error: ${result.content}` : result.content,
        });
      }
    }
  }
  return out;
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI, Ollama and any OpenAI-compatible server share the Chat Completions wire format.
 * Ollama serves it under `<endpoint>/v1` and ignores the API key.
 */
export function createOpenAIAdapter(access: ProviderAccess): ProviderAdapter {
  const provider = access.provider;
  const baseURL =
    provider === 'ollama'
      ? `${(access.endpoint ?? 'http://localhost:11434').replace(/\/+$/, '')}/v1`
      : access.endpoint || undefined;
  const client = new OpenAI({
    apiKey: access.apiKey || (provider === 'openai' ? undefined : 'not-needed'),
    baseURL,
    maxRetries: 1,
    timeout: TIMEOUT_MS,
  });

  return {
    provider,

    async listModels(): Promise<DiscoveredModel[]> {
      try {
        const models: DiscoveredModel[] = [];
        for await (const model of client.models.list()) models.push({ id: model.id });
        return models.sort((a, b) => a.id.localeCompare(b.id));
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async embed(request: EmbedRequest): Promise<EmbedResult> {
      try {
        const response = await client.embeddings.create(
          {
            model: request.model,
            input: request.inputs,
            encoding_format: 'float',
            // Only OpenAI's own API is known to accept a target size.
            ...(provider === 'openai' && { dimensions: EMBEDDING_DIMENSIONS }),
          },
          { signal: request.signal },
        );
        const vectors = [...response.data]
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
        return {
          vectors: checkDimensions(vectors, EMBEDDING_DIMENSIONS, request.inputs.length),
          inputTokens: response.usage?.prompt_tokens ?? 0,
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const response = await client.chat.completions.create(
          {
            model: request.model,
            messages: toMessages(request.system, request.messages),
            // OpenAI's own API renamed the cap; compatible servers still expect max_tokens.
            ...(provider === 'openai'
              ? { max_completion_tokens: request.maxOutputTokens }
              : { max_tokens: request.maxOutputTokens }),
            ...(request.temperature !== undefined && { temperature: request.temperature }),
            ...(request.tools?.length && {
              tools: request.tools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }),
          },
          { signal: request.signal },
        );
        const choice = response.choices[0];
        const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).flatMap((call) =>
          call.type === 'function'
            ? [
                {
                  id: call.id,
                  name: call.function.name,
                  arguments: parseArguments(call.function.arguments),
                  rawArguments: call.function.arguments,
                },
              ]
            : [],
        );
        return {
          text: choice?.message.content ?? '',
          stopReason:
            toolCalls.length > 0 ? 'tool_use' : (STOP[choice?.finish_reason ?? ''] ?? 'other'),
          model: response.model || request.model,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          providerFallbacks: [],
          toolCalls,
          providerContent: null,
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
