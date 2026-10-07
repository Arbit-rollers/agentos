import { randomUUID } from 'node:crypto';
import { ApiError, GoogleGenAI, type Content, type Part } from '@google/genai';
import { ProviderError, errorKindForStatus } from '../errors';
import type {
  ChatMessage,
  DiscoveredModel,
  GenerateRequest,
  GenerateResult,
  ProviderAccess,
  ProviderAdapter,
  StopReason,
  ToolCall,
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

/** Gemini turns; model turns from Gemini go back unchanged (they carry thought signatures). */
function toContents(messages: ChatMessage[]): Content[] {
  return messages.map((message): Content => {
    if (message.role === 'user') return { role: 'user', parts: [{ text: message.content }] };
    if (message.role === 'assistant') {
      if (message.providerContent?.provider === 'google') {
        return { role: 'model', parts: message.providerContent.content as Part[] };
      }
      return {
        role: 'model',
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            functionCall: { id: call.id, name: call.name, args: call.arguments ?? {} },
          })),
        ],
      };
    }
    return {
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          id: result.toolCallId,
          name: result.name,
          response: result.isError ? { error: result.content } : { output: result.content },
        },
      })),
    };
  });
}

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
          contents: toContents(request.messages),
          config: {
            ...(request.system && { systemInstruction: request.system }),
            ...(request.maxOutputTokens && { maxOutputTokens: request.maxOutputTokens }),
            ...(request.temperature !== undefined && { temperature: request.temperature }),
            ...(request.signal && { abortSignal: request.signal }),
            ...(request.tools?.length && {
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.inputSchema,
                  })),
                },
              ],
            }),
          },
        });
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const toolCalls: ToolCall[] = parts.flatMap((part) =>
          part.functionCall?.name
            ? [
                {
                  id: part.functionCall.id ?? randomUUID(),
                  name: part.functionCall.name,
                  arguments: part.functionCall.args ?? {},
                },
              ]
            : [],
        );
        return {
          text: parts.flatMap((part) => (part.text && !part.thought ? [part.text] : [])).join(''),
          stopReason:
            toolCalls.length > 0
              ? 'tool_use'
              : (STOP[response.candidates?.[0]?.finishReason ?? ''] ?? 'other'),
          model: response.modelVersion ?? request.model,
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          },
          providerFallbacks: [],
          toolCalls,
          providerContent: parts,
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
