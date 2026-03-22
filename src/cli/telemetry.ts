import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import { loadConfig, saveConfig, getConfigPath } from '../storage/config.js';

export function registerTelemetryCommand(program: Command): void {
  program
    .command('telemetry')
    .description('View or toggle anonymous telemetry')
    .argument('[toggle]', 'on or off')
    .action((toggle?: string) => {
      const configPath = getConfigPath();
      if (!fs.existsSync(configPath)) {
        console.log(chalk.red('Not initialized. Run `fbl init` first.'));
        return;
      }

      const config = loadConfig();

      if (!toggle) {
        // Show current status
        const status = config.telemetry.enabled ? chalk.green('on') : chalk.red('off');
        console.log(`\nTelemetry is currently ${status}`);
        console.log(chalk.dim('\nWhat fbl collects (when enabled):'));
        console.log(chalk.dim('  - Anonymous friction types (e.g. "missing CLAUDE.md rule")'));
        console.log(chalk.dim('  - Suggestion categories'));
        console.log(chalk.dim('  - Session metadata (duration, message count)'));
        console.log(chalk.dim('\nWhat fbl never collects:'));
        console.log(chalk.dim('  - Code, file contents, or file paths'));
        console.log(chalk.dim('  - Transcripts or conversation text'));
        console.log(chalk.dim('  - API keys or personal information'));
        console.log(`\nToggle: ${chalk.cyan('fbl telemetry on')} / ${chalk.cyan('fbl telemetry off')}\n`);
        return;
      }

      if (toggle !== 'on' && toggle !== 'off') {
        console.log(chalk.red(`Invalid value: "${toggle}". Use "on" or "off".`));
        return;
      }

      const enabled = toggle === 'on';
      config.telemetry.enabled = enabled;
      saveConfig(config);

      if (enabled) {
        console.log(chalk.green('\nTelemetry enabled.'));
        console.log(chalk.dim('Anonymous friction types only — no code, no transcripts.\n'));
      } else {
        console.log(chalk.yellow('\nTelemetry disabled.'));
        console.log(chalk.dim('No data will be sent. You can re-enable anytime with `fbl telemetry on`.\n'));
      }
    });
}
