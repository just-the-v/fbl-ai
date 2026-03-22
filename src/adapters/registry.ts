import type { LLMAdapter } from './types.js';
import type { Config } from '../storage/config.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenRouterAdapter } from './openrouter.js';
import { OllamaAdapter } from './local.js';

export function createAdapter(config: Config): LLMAdapter {
  switch (config.provider.type) {
    case 'anthropic':
      if (!config.provider.api_key) throw new Error('Anthropic API key required');
      return new AnthropicAdapter(config.provider.api_key, config.provider.model);
    case 'openrouter':
      if (!config.provider.api_key) throw new Error('OpenRouter API key required');
      return new OpenRouterAdapter(config.provider.api_key, config.provider.model);
    case 'local':
      return new OllamaAdapter(config.provider.model, config.provider.base_url);
    default:
      throw new Error(`Unknown provider: ${(config.provider as { type: string }).type}`);
  }
}
