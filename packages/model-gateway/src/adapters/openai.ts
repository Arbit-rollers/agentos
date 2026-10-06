import OpenAI from 'openai';
import { ProviderError, errorKindForStatus } from '../errors';
import type {
  DiscoveredModel,
  GenerateRequest,
  GenerateResult,
  ProviderAccess,
  ProviderAdapter,
  StopReason,
} from '../types';

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
  length: 'max_tokens',
  content_filter: 'refusal',
};

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

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const response = await client.chat.completions.create(
          {
            model: request.model,
            messages: [
              ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
              ...request.messages,
            ],
            // OpenAI's own API renamed the cap; compatible servers still expect max_tokens.
            ...(provider === 'openai'
              ? { max_completion_tokens: request.maxOutputTokens }
              : { max_tokens: request.maxOutputTokens }),
            ...(request.temperature !== undefined && { temperature: request.temperature }),
          },
          { signal: request.signal },
        );
        const choice = response.choices[0];
        return {
          text: choice?.message.content ?? '',
          stopReason: STOP[choice?.finish_reason ?? ''] ?? 'other',
          model: response.model || request.model,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          providerFallbacks: [],
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
