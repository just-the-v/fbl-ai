import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, password, confirm } from '@inquirer/prompts';
import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { saveConfig, loadConfig, getConfigPath } from '../storage/config.js';
import { createAdapter } from '../adapters/registry.js';
import type { Config } from '../storage/config.js';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Set up fbl')
    .action(async () => {
      console.log(chalk.bold('\nfbl v0.1.0'));
      console.log(chalk.gray('Automated session analysis for Claude Code\n'));

      // Check if already initialized
      try {
        loadConfig();
        const reconfigure = await confirm({ message: 'Already initialized. Reconfigure?', default: false });
        if (!reconfigure) return;
      } catch { /* not initialized, continue */ }

      // 1. Choose provider
      const providerType = await select({
        message: 'Choose your LLM provider:',
        choices: [
          { value: 'anthropic', name: 'Anthropic (recommended — fast, accurate)' },
          { value: 'openrouter', name: 'OpenRouter (100+ models, flexible pricing)' },
          { value: 'local', name: 'Local (Ollama — private, no API key needed)' },
        ],
      }) as 'anthropic' | 'openrouter' | 'local';

      let apiKey: string | undefined;
      let model: string | undefined;
      let baseUrl: string | undefined;

      // 2. Provider-specific config
      if (providerType === 'anthropic') {
        apiKey = await password({ message: 'Enter your Anthropic API key:' });
      } else if (providerType === 'openrouter') {
        apiKey = await password({ message: 'Enter your OpenRouter API key:' });
      } else {
        // Local: check Ollama is running
        const spinner = ora('Checking Ollama...').start();
        try {
          const res = await fetch('http://localhost:11434/api/tags');
          if (res.ok) {
            spinner.succeed('Ollama is running');
          } else {
            spinner.fail('Ollama responded but returned an error');
            return;
          }
        } catch {
          spinner.fail('Ollama is not running. Start it with: ollama serve');
          return;
        }
        model = 'llama3.1:8b';
      }

      // 3. Telemetry opt-in
      const telemetryEnabled = await confirm({
        message: 'Help improve recommendations by sharing anonymous analytics?',
        default: true,
      });

      // 4. Verify connection
      const config: Config = {
        version: 1,
        provider: { type: providerType, api_key: apiKey, model, base_url: baseUrl },
        telemetry: {
          enabled: telemetryEnabled,
          device_id: createHash('sha256').update(hostname() + userInfo().username).digest('hex'),
        },
        analysis: { auto_analyze: true, min_messages: 5 },
      };

      if (providerType !== 'local') {
        const spinner = ora('Verifying connection...').start();
        try {
          const adapter = createAdapter(config);
          const available = await adapter.isAvailable();
          if (available) {
            spinner.succeed('Connection verified');
          } else {
            spinner.fail('Could not connect. Check your API key.');
            return;
          }
        } catch (err) {
          spinner.fail(`Connection failed: ${err instanceof Error ? err.message : err}`);
          return;
        }
      }

      // 5. Save config
      saveConfig(config);

      // 6. Install hook in ~/.claude/settings.json
      installHook();

      console.log(chalk.green('\n✔ You\'re all set!\n'));
      console.log(`Config saved to ${chalk.cyan(getConfigPath())}`);
      console.log(`\nYour next Claude Code session will be analyzed automatically.`);
      console.log(`Run ${chalk.cyan('fbl analyze --last 7d')} to analyze past sessions.`);
      console.log(`Run ${chalk.cyan('fbl report')} anytime to see your insights.\n`);
    });
}

function installHook() {
  const settingsPath = path.join(process.env.HOME || '~', '.claude', 'settings.json');
  const settingsDir = path.dirname(settingsPath);

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch { settings = {}; }
  }

  if (!settings.hooks) settings.hooks = {};

  // Add SessionEnd hook without overwriting existing hooks
  if (!settings.hooks.SessionEnd) {
    settings.hooks.SessionEnd = [];
  }

  // Check if already installed (search in both old flat format and new matcher format)
  const hookExists = settings.hooks.SessionEnd.some((entry: any) => {
    // New format: { matcher, hooks: [...] }
    if (entry.hooks && Array.isArray(entry.hooks)) {
      return entry.hooks.some((h: any) => h.command?.includes('feedback-loop') || h.command?.includes('fbl'));
    }
    // Old flat format: { command }
    return entry.command?.includes('feedback-loop') || entry.command?.includes('fbl');
  });

  if (!hookExists) {
    settings.hooks.SessionEnd.push({
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: 'fbl hook-handler',
          timeout: 5000,
        },
      ],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
