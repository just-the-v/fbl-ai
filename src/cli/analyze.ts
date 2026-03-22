import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../storage/config.js';
import { discoverSessions } from '../storage/sessions.js';
import { isAlreadyAnalyzed, storeAnalysis } from '../storage/analyses.js';
import { loadSuggestionsIndex, saveSuggestionsIndex } from '../storage/suggestions.js';
import { analyzeSession } from '../core/analyzer.js';
import { formatCostComparison } from '../core/cost-estimator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function sessionIdFromPath(filePath: string): string {
  return path.basename(filePath, '.jsonl');
}

export function registerAnalyzeCommand(program: Command) {
  program
    .command('analyze')
    .description('Analyze past Claude Code sessions')
    .requiredOption('--last <duration>', 'Time period to analyze (e.g., 7d, 30d, 24h)')
    .option('--yes', 'Skip confirmation prompt')
    .option('--verbose', 'Show detailed error messages for failed sessions')
    .action(async (opts) => {
      // 1. Load config (error if not initialized)
      let config;
      try {
        config = loadConfig();
      } catch {
        console.log(chalk.red('Not initialized. Run `fbl init` first.'));
        return;
      }

      // 2. Discover sessions
      const sessions = discoverSessions(opts.last);
      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found in the specified period.'));
        return;
      }

      // 3. Filter already analyzed
      const toAnalyze = sessions.filter(
        (s) => !isAlreadyAnalyzed(sessionIdFromPath(s.path)),
      );
      if (toAnalyze.length === 0) {
        console.log(chalk.green('All sessions already analyzed!'));
        return;
      }

      // 4. Show cost estimation
      const sessionFiles = toAnalyze.map((s) => ({
        path: s.path,
        size: fs.statSync(s.path).size,
      }));
      console.log(`\nFound ${sessions.length} sessions (${toAnalyze.length} new)\n`);
      console.log(formatCostComparison(sessionFiles));

      // 5. Confirm
      if (!opts.yes) {
        try {
          const proceed = await confirm({
            message: `Proceed with ${config.provider.type}?`,
            default: true,
          });
          if (!proceed) return;
        } catch {
          // stdin not a TTY or prompt closed — default to abort
          console.log(chalk.yellow('No interactive terminal detected. Use --yes to skip confirmation.'));
          return;
        }
      }

      // 6. Analyze with progress
      const spinner = ora({ text: 'Analyzing sessions...', isSilent: !process.stderr.isTTY }).start();
      let analyzed = 0,
        skipped = 0,
        failed = 0;
      const errors: { path: string; error: string }[] = [];
      const concurrency = 1; // Sequential to avoid rate limits

      // Simple concurrency pool
      const queue = [...toAnalyze];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < concurrency; i++) {
        promises.push(
          (async () => {
            while (queue.length > 0) {
              const session = queue.shift()!;
              try {
                spinner.text = `Analyzing ${analyzed + skipped + failed + 1}/${toAnalyze.length}...`;
                const result = await analyzeSession(session.path, { config, projectPath: process.cwd() });
                if (result) {
                  storeAnalysis(result);
                  // Update suggestions index
                  const index = loadSuggestionsIndex();
                  for (const s of result.suggestions) {
                    index.push({
                      ...s,
                      source_analysis: result.session_id,
                      ...(result.project_path ? { project_path: result.project_path } : {}),
                    });
                  }
                  saveSuggestionsIndex(index);
                  analyzed++;
                } else {
                  skipped++;
                }
              } catch (err) {
                failed++;
                errors.push({
                  path: session.path,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          })(),
        );
      }
      await Promise.all(promises);

      spinner.succeed(
        `Done! ${analyzed} analyzed, ${skipped} skipped (too short), ${failed} failed`,
      );

      if (errors.length > 0) {
        if (opts.verbose) {
          console.log(chalk.red('\nFailed sessions:'));
          for (const e of errors) {
            console.log(chalk.red(`  ${e.path}: ${e.error}`));
          }
        } else {
          console.log(
            chalk.yellow(`\n${errors.length} failed (run with --verbose to see details)`),
          );
        }
      }

      console.log(`\nRun ${chalk.cyan('fbl report')} to see your insights.`);
    });
}
