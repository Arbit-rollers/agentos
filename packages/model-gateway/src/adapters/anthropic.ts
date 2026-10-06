import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, errorKindForStatus } from '../errors';
import type {
  DiscoveredModel,
  GenerateRequest,
  GenerateResult,
  ProviderAccess,
  ProviderAdapter,
  ProviderFallback,
  StopReason,
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
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

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
        messages: request.messages,
        // Current Claude models reject sampling parameters; the registry only lets
        // temperature through for models that accept it.
        ...(request.temperature !== undefined && { temperature: request.temperature }),
      };
      try {
        if (!SERVER_FALLBACK_MODELS.has(request.model)) {
          const response = await client.messages.create(params, { signal: request.signal });
          return {
            text: response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
            stopReason: STOP[response.stop_reason ?? ''] ?? 'other',
            model: response.model,
            usage: {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
            },
            providerFallbacks: [],
          };
        }

        const response = await client.beta.messages.create(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal: request.signal },
        );
        const providerFallbacks: ProviderFallback[] = [];
        let text = '';
        for (const block of response.content) {
          if (block.type === 'text') text += block.text;
          if (block.type === 'fallback') {
            providerFallbacks.push({ from: block.from.model, to: block.to.model });
          }
        }
        return {
          text,
          stopReason: STOP[response.stop_reason ?? ''] ?? 'other',
          model: response.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          providerFallbacks,
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
