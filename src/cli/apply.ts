import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { getDisplaySuggestions, updateSuggestionStatus } from '../storage/suggestions.js';

function shortProjectName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

export function registerApplyCommand(program: Command) {
  program
    .command('apply <number>')
    .description('Apply a suggestion using Claude Code')
    .option('--dry-run', 'Show the suggestion and target file without applying')
    .action(async (numberStr, opts) => {
      const n = parseInt(numberStr, 10);
      if (isNaN(n) || n < 1) {
        console.log(chalk.red('Invalid suggestion number. Run `fbl report` to see available suggestions.'));
        return;
      }

      // 1. Get display suggestions (same dedup + sort as report)
      const displayed = getDisplaySuggestions();
      if (displayed.length === 0) {
        console.log(chalk.yellow('No pending suggestions. Run `fbl analyze --last 7d` first.'));
        return;
      }

      const suggestion = displayed[n - 1];
      if (!suggestion) {
        console.log(chalk.red(`Suggestion #${n} not found. Available: 1-${displayed.length}`));
        return;
      }

      // 2. Determine target file and project path
      let targetFile: string;
      let projectPath: string | undefined;
      if (suggestion.scope === 'global') {
        targetFile = '~/.claude/CLAUDE.md';
      } else if (suggestion.projects && suggestion.projects.length === 1) {
        projectPath = suggestion.projects[0];
        targetFile = `${projectPath}/CLAUDE.md`;
      } else {
        try {
          const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
          projectPath = gitRoot;
          targetFile = `${gitRoot}/CLAUDE.md`;
        } catch {
          targetFile = '~/.claude/CLAUDE.md';
        }
      }

      // 3. Dry run: show details and exit
      if (opts.dryRun) {
        console.log(chalk.cyan('\n--- Dry Run ---\n'));
        console.log(`${chalk.bold('Suggestion #' + n)}`);
        if (projectPath) {
          console.log(`${chalk.bold('Project:')}   ${shortProjectName(projectPath)} (${projectPath})`);
        }
        console.log(`${chalk.bold('Target:')}    ${suggestion.target}`);
        console.log(`${chalk.bold('Scope:')}     ${suggestion.scope}`);
        console.log(`${chalk.bold('File:')}      ${targetFile}`);
        console.log(`${chalk.bold('Confidence:')} ${(suggestion.confidence * 100).toFixed(0)}%`);
        console.log(`${chalk.bold('Sessions:')}  ${suggestion.sessionCount}`);
        console.log(`\n${chalk.bold('Rule:')}`);
        console.log(`  ${suggestion.rule}`);
        console.log(`\n${chalk.bold('Reasoning:')}`);
        console.log(`  ${suggestion.reasoning}`);
        console.log(chalk.cyan('\n--- End Dry Run (no changes made) ---'));
        return;
      }

      // 4. Check if Claude Code is available
      try {
        execSync('which claude', { stdio: 'ignore' });
      } catch {
        console.log(chalk.red('Claude Code not found in PATH. Install it first: https://claude.ai/code'));
        return;
      }

      // 5. Build prompt and launch Claude Code headless
      const rule = suggestion.rule.replace(/"/g, '\\"');
      const prompt = `Read the file ${targetFile} (create it if it doesn't exist). Add this rule in the most appropriate section (create the section if needed): "${rule}". Integrate it naturally with the existing content style. Do not remove or modify existing rules.`;

      console.log(chalk.cyan('\nLaunching Claude Code to apply suggestion...\n'));

      try {
        execSync(`claude -p "${prompt}" --allowedTools Edit,Read,Write`, {
          stdio: 'inherit',
        });
      } catch (err) {
        console.log(chalk.red('\nClaude Code execution failed.'));
        return;
      }

      // 6. Mark as applied
      updateSuggestionStatus(suggestion.id, 'applied', new Date().toISOString());
      console.log(chalk.green(`\nSuggestion [${n}] marked as applied.`));
    });
}
