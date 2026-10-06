import type { ProviderAccess, ProviderAdapter } from '../types';
import { createAnthropicAdapter } from './anthropic';
import { createGoogleAdapter } from './google';
import { createOpenAIAdapter } from './openai';

export function createAdapter(access: ProviderAccess): ProviderAdapter {
  switch (access.provider) {
    case 'anthropic':
      return createAnthropicAdapter(access);
    case 'google':
      return createGoogleAdapter(access);
    case 'openai':
    case 'ollama':
    case 'openai_compatible':
      return createOpenAIAdapter(access);
  }
}
