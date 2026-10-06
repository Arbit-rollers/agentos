import { ApiError, GoogleGenAI } from '@google/genai';
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
  if (error instanceof ApiError) {
    return new ProviderError(
      errorKindForStatus(error.status),
      `Provider returned HTTP ${error.status}`,
      error.status,
    );
  }
  if (error instanceof TypeError) {
    // fetch() network failures surface as TypeError.
    return new ProviderError('unavailable', 'Could not reach the provider');
  }
  return error;
}

const STOP: Record<string, StopReason> = {
  STOP: 'end',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'refusal',
  PROHIBITED_CONTENT: 'refusal',
  BLOCKLIST: 'refusal',
};

export function createGoogleAdapter(access: ProviderAccess): ProviderAdapter {
  const client = new GoogleGenAI({
    apiKey: access.apiKey ?? undefined,
    httpOptions: { timeout: TIMEOUT_MS, ...(access.endpoint && { baseUrl: access.endpoint }) },
  });

  return {
    provider: 'google',

    async listModels(): Promise<DiscoveredModel[]> {
      try {
        const models: DiscoveredModel[] = [];
        for await (const model of await client.models.list()) {
          if (!model.name || !model.supportedActions?.includes('generateContent')) continue;
          models.push({
            id: model.name.replace(/^models\//, ''),
            displayName: model.displayName,
            contextWindow: model.inputTokenLimit,
            maxOutputTokens: model.outputTokenLimit,
          });
        }
        return models;
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async generate(request: GenerateRequest): Promise<GenerateResult> {
      try {
        const response = await client.models.generateContent({
          model: request.model,
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          config: {
            ...(request.system && { systemInstruction: request.system }),
            ...(request.maxOutputTokens && { maxOutputTokens: request.maxOutputTokens }),
            ...(request.temperature !== undefined && { temperature: request.temperature }),
            ...(request.signal && { abortSignal: request.signal }),
          },
        });
        return {
          text: response.text ?? '',
          stopReason: STOP[response.candidates?.[0]?.finishReason ?? ''] ?? 'other',
          model: response.modelVersion ?? request.model,
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          },
          providerFallbacks: [],
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
