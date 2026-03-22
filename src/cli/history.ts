import { Command } from 'commander';
import chalk from 'chalk';
import { listAnalyses } from '../storage/analyses.js';
import { getSuggestionsByStatus } from '../storage/suggestions.js';

function parseDurationMs(value: string): number {
  const match = value.match(/^(\d+)\s*(d|h)$/i);
  if (!match) throw new Error(`Invalid duration format: "${value}". Use format like "30d" or "24h".`);
  const num = parseInt(match[1], 10);
  if (num === 0) throw new Error('Please specify a duration of at least 1 day.');
  const unit = match[2].toLowerCase();
  if (unit === 'h') return num * 60 * 60 * 1000;
  return num * 24 * 60 * 60 * 1000;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} ${timePart}`;
}

function shortProjectName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return chalk.dim('n/a');
  if (seconds < 60) return `${seconds}s`;
  const totalMins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (totalMins >= 60) {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
  return secs > 0 ? `${totalMins}m${secs}s` : `${totalMins}m`;
}

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('Show past session analyses')
    .option('--last <duration>', 'Time period filter (e.g., 30d, 24h)', '30d')
    .option('--all', 'Show all analyses without limit')
    .action((opts: { last: string; all?: boolean }) => {
      let analyses;

      if (opts.all) {
        analyses = listAnalyses();
      } else {
        const ms = parseDurationMs(opts.last);
        const since = new Date(Date.now() - ms);
        analyses = listAnalyses({ since });
      }

      if (analyses.length === 0) {
        console.log(chalk.yellow('\nNo analyses yet. Run `fbl analyze --last 7d`\n'));
        return;
      }

      // Header stats
      const totalFrictions = analyses.reduce((sum, a) => sum + a.frictions.reduce((s, f) => s + f.count, 0), 0);
      const pendingSuggestions = getSuggestionsByStatus('pending').length;

      const periodLabel = opts.all ? 'all time' : `last ${opts.last}`;
      console.log(
        chalk.bold(`\n${analyses.length} sessions analyzed (${periodLabel}), ${totalFrictions} frictions found, ${pendingSuggestions} suggestions pending`),
      );
      console.log(chalk.dim('─'.repeat(60)));

      // Display entries (max 20 unless --all)
      const displayLimit = opts.all ? analyses.length : 20;
      const displayed = analyses.slice(0, displayLimit);

      for (const analysis of displayed) {
        // UX-9: Use session start time instead of analysis time when available
        const sessionDate = analysis.session_started_at ?? analysis.analyzed_at;
        const date = formatDate(sessionDate);
        const duration = formatDuration(analysis.duration_seconds);
        const frictionCount = analysis.frictions.reduce((s, f) => s + f.count, 0);

        // UX-8: Show project name next to each session entry
        const projectLabel = analysis.project_path
          ? chalk.dim(` [${shortProjectName(analysis.project_path)}]`)
          : '';

        console.log(
          `\n  ${chalk.cyan(date)}${projectLabel}  ${chalk.dim('|')}  Duration: ${duration}  ${chalk.dim('|')}  Frictions: ${frictionCount}`,
        );

        // Show frictions sorted by severity
        if (analysis.frictions.length > 0) {
          const sortedFrictions = [...analysis.frictions]
            .sort((a, b) => {
              const severityOrder = { high: 3, medium: 2, low: 1 };
              return severityOrder[b.severity] - severityOrder[a.severity];
            });

          const maxDisplay = 5;
          const displayFrictions = sortedFrictions.slice(0, maxDisplay);
          const remaining = sortedFrictions.length - displayFrictions.length;

          for (const f of displayFrictions) {
            const severityColorFn =
              f.severity === 'high' ? chalk.red : f.severity === 'medium' ? chalk.yellow : chalk.green;
            console.log(`    ${severityColorFn(`[${f.severity}]`)} ${f.type} (x${f.count})`);
          }

          if (remaining > 0) {
            console.log(chalk.dim(`    +${remaining} more friction${remaining > 1 ? 's' : ''}`));
          }
        }
      }

      if (!opts.all && analyses.length > displayLimit) {
        console.log(chalk.dim(`\n  ... and ${analyses.length - displayLimit} more. Use --all to see everything.`));
      }

      // UX-12 + UX-13: Warn about legacy sessions without project data or session timestamps
      const legacyCount = displayed.filter(a => !a.project_path || !a.session_started_at).length;
      if (legacyCount > 0) {
        console.log(
          chalk.yellow(`\n  ${legacyCount} session${legacyCount > 1 ? 's' : ''} lack${legacyCount === 1 ? 's' : ''} project/date data (dates shown may be analysis time). Run \`fbl analyze --last 30d --yes\` to re-analyze.`),
        );
      }

      // Trend: compare this week vs last week
      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const thisWeek = analyses.filter(
        (a) => new Date(a.analyzed_at).getTime() >= now - oneWeekMs,
      );
      const lastWeek = analyses.filter((a) => {
        const t = new Date(a.analyzed_at).getTime();
        return t >= now - 2 * oneWeekMs && t < now - oneWeekMs;
      });

      if (thisWeek.length > 0 && lastWeek.length > 0) {
        const avgThis =
          thisWeek.reduce((s, a) => s + a.frictions.reduce((fs, f) => fs + f.count, 0), 0) / thisWeek.length;
        const avgLast =
          lastWeek.reduce((s, a) => s + a.frictions.reduce((fs, f) => fs + f.count, 0), 0) / lastWeek.length;

        const diff = avgThis - avgLast;
        const arrow = diff < 0 ? chalk.green('v') : diff > 0 ? chalk.red('^') : chalk.dim('=');
        const color = diff < 0 ? chalk.green : diff > 0 ? chalk.red : chalk.dim;
        const direction = diff < 0 ? 'down' : diff > 0 ? 'up' : 'stable';

        console.log(
          `\n  ${chalk.bold('Trend:')} ${arrow} avg frictions ${color(`${Math.abs(diff).toFixed(1)} ${direction}`)} vs last week`,
        );
      }

      console.log();
    });
}
