import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../storage/config.js';
import * as fs from 'node:fs';
import { getConfigPath } from '../storage/config.js';

function maskApiKey(key: string): string {
  if (key.length <= 7) return '***';
  return key.slice(0, 4) + '***' + key.slice(-3);
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openrouter: 'meta-llama/llama-3.1-8b-instruct',
  local: 'llama3.1:8b',
};

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-5-20250514': 'Sonnet 4.5',
  'claude-opus-4-5-20250514': 'Opus 4.5',
  'claude-sonnet-4-6-20250620': 'Sonnet 4.6',
  'claude-opus-4-6-20250620': 'Opus 4.6',
};

function friendlyModelName(modelId: string): string {
  return FRIENDLY_MODEL_NAMES[modelId] ?? modelId;
}

function resolveModelDisplay(provider: string, model?: string): string {
  const defaultModel = DEFAULT_MODELS[provider] ?? 'unknown';
  if (!model) return friendlyModelName(defaultModel);
  return friendlyModelName(model);
}

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('View or update fbl configuration')
    .option('--provider <type>', 'Set provider (anthropic/openrouter/local)')
    .option('--api-key <key>', 'Set API key')
    .option('--model <model>', 'Set model')
    .option('--telemetry <toggle>', 'Enable or disable telemetry (on/off)')
    .action((opts: { provider?: string; apiKey?: string; model?: string; telemetry?: string }) => {
      const configPath = getConfigPath();
      if (!fs.existsSync(configPath)) {
        console.log(chalk.red('Not initialized. Run `fbl init` first.'));
        return;
      }

      const hasUpdate = opts.provider || opts.apiKey || opts.model || opts.telemetry;

      if (hasUpdate) {
        const config = loadConfig();

        if (opts.provider) {
          const valid = ['anthropic', 'openrouter', 'local'] as const;
          if (!valid.includes(opts.provider as typeof valid[number])) {
            console.log(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: ${valid.join(', ')}`));
            return;
          }
          config.provider.type = opts.provider as typeof valid[number];
        }

        if (opts.apiKey) {
          config.provider.api_key = opts.apiKey;
        }

        if (opts.model) {
          config.provider.model = opts.model;
        }

        if (opts.telemetry) {
          if (opts.telemetry !== 'on' && opts.telemetry !== 'off') {
            console.log(chalk.red('Invalid telemetry value. Use "on" or "off".'));
            return;
          }
          config.telemetry.enabled = opts.telemetry === 'on';
        }

        saveConfig(config);
        console.log(chalk.green('Configuration updated.'));
      }

      if (!hasUpdate) {
        const config = loadConfig();
        console.log(chalk.bold('\nfbl configuration'));
        console.log(chalk.dim('─'.repeat(30)));
        console.log(`  Provider:   ${chalk.cyan(config.provider.type)}`);
        console.log(`  API Key:    ${config.provider.api_key ? chalk.cyan(maskApiKey(config.provider.api_key)) : chalk.dim('not set')}`);
        console.log(`  Model:      ${chalk.cyan(resolveModelDisplay(config.provider.type, config.provider.model))}`);
        console.log(`  Telemetry:  ${config.telemetry.enabled ? chalk.green('on') : chalk.red('off')}`);
        console.log(`  Device ID:  ${chalk.dim(config.telemetry.device_id)}`);
        console.log();
      }
    });
}
