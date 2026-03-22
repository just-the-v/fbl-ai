import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { listAnalyses } from '../storage/analyses.js';
import { getDisplaySuggestions } from '../storage/suggestions.js';
import { getCachedRecommendations, findRelevantRecommendation } from '../storage/recommendations.js';
import type { Friction } from '../core/schema.js';

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(d|days?)$/i);
  if (!match) throw new Error(`Invalid duration format: "${value}". Use format like "7d".`);
  const days = parseInt(match[1], 10);
  if (days === 0) throw new Error('Please specify a duration of at least 1 day.');
  return days;
}

function buildBarChart(value: number, max: number, width: number = 10): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function severityColor(severity: 'low' | 'medium' | 'high'): (text: string) => string {
  switch (severity) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.green;
  }
}

function targetLabel(target: string): string {
  switch (target) {
    case 'claude_md':
      return 'CLAUDE.md';
    case 'skill':
      return 'Skill';
    case 'workflow':
      return 'Workflow';
    case 'hook':
      return 'Hook';
    case 'settings':
      return 'Settings';
    default:
      return target;
  }
}

function shortProjectName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

function detectCurrentProject(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return process.cwd();
  }
}

function projectTag(projects: string[] | undefined): string {
  if (!projects || projects.length === 0) return ' · unscoped';
  if (projects.length === 1) return ` · ${shortProjectName(projects[0])}`;
  return ` · global (${projects.length} projects)`;
}

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Show aggregated report of frictions and suggestions')
    .option('--last <duration>', 'Time window to analyze (e.g. 7d)', '7d')
    .option('--full', 'Show all suggestions (default: max 10)')
    .option('--all', 'Show all suggestions (alias for --full)')
    .option('--global', 'Show suggestions from all projects (no project filter)')
    .action((options: { last: string; full?: boolean; all?: boolean; global?: boolean }) => {
      const showAll = options.full || options.all;
      const days = parseDuration(options.last);
      const since = new Date();
      since.setDate(since.getDate() - days);

      const analyses = listAnalyses({ since });

      if (analyses.length === 0) {
        console.log(
          chalk.yellow('\nNo analyses found for the last %d days.'),
          days,
        );
        console.log(
          chalk.dim('  Run: fbl analyze --last %dd\n'),
          days,
        );
        return;
      }

      // Detect project filter
      const currentProject = options.global ? undefined : detectCurrentProject();
      const projectLabel = currentProject ? shortProjectName(currentProject) : 'all projects';

      // Header with actual date range
      const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
      const oldestDate = new Date(analyses[analyses.length - 1].analyzed_at);
      const newestDate = new Date(analyses[0].analyzed_at);
      const oldestStr = oldestDate.toLocaleDateString('en-US', dateOpts);
      const newestStr = newestDate.toLocaleDateString('en-US', dateOpts);
      const dateRange = oldestStr === newestStr ? newestStr : `${oldestStr} — ${newestStr}`;
      console.log(
        chalk.bold(`\nSession Report — ${projectLabel}`),
      );
      console.log(chalk.dim(`${dateRange}`));
      console.log(chalk.dim('─'.repeat(36)));
      console.log(`Sessions analyzed: ${chalk.bold(String(analyses.length))}\n`);

      // Aggregate frictions by type
      const frictionMap = new Map<string, { count: number; severity: 'low' | 'medium' | 'high' }>();
      for (const analysis of analyses) {
        for (const friction of analysis.frictions) {
          const existing = frictionMap.get(friction.type);
          if (existing) {
            existing.count += friction.count;
            // Keep highest severity
            if (severityRank(friction.severity) > severityRank(existing.severity)) {
              existing.severity = friction.severity;
            }
          } else {
            frictionMap.set(friction.type, { count: friction.count, severity: friction.severity });
          }
        }
      }

      if (frictionMap.size > 0) {
        const sorted = [...frictionMap.entries()].sort((a, b) => b[1].count - a[1].count);
        const maxCount = sorted[0][1].count;
        const maxTypeLen = Math.max(...sorted.map(([type]) => type.length));

        console.log(chalk.bold('Top Frictions'));
        for (const [type, { count, severity }] of sorted) {
          const colorFn = severityColor(severity);
          const paddedType = type.padEnd(maxTypeLen);
          const bar = buildBarChart(count, maxCount);
          console.log(`  ${colorFn(paddedType)}  ${bar}  ${count} occurrence${count > 1 ? 's' : ''}`);
        }
        console.log();
      }

      // Suggestions (pending, deduplicated, sorted by confidence desc)
      const projectDeduped = getDisplaySuggestions(undefined, currentProject);
      const globalDeduped = getDisplaySuggestions(undefined, undefined);
      const allDeduped = projectDeduped;
      const displayLimit = showAll ? allDeduped.length : 10;
      const displayed = allDeduped.slice(0, displayLimit);

      if (displayed.length > 0) {
        console.log(chalk.bold('Suggestions'));
        for (let i = 0; i < displayed.length; i++) {
          const s = displayed[i];
          const label = targetLabel(s.target);
          const tag = projectTag(s.projects);
          console.log(
            `  ${chalk.cyan(`[${i + 1}]`)} ${chalk.cyan(`[${label}${tag}]`)} ${chalk.white(`"${s.rule}"`)}`,
          );
          console.log(
            `                  Confidence: ${s.confidence} | Based on: ${s.sessionCount} session${s.sessionCount > 1 ? 's' : ''}`,
          );
        }
        if (allDeduped.length > displayLimit) {
          console.log(
            chalk.dim(`  (${allDeduped.length - displayLimit} more suggestions hidden, use --full to show)`),
          );
        }

        // BUG-5: When all project-scoped suggestions are shown, add context about other projects
        if (currentProject && showAll && globalDeduped.length > allDeduped.length) {
          const otherCount = globalDeduped.length - allDeduped.length;
          console.log(
            chalk.dim(`  ${allDeduped.length} project suggestions shown (${otherCount} more from other projects — use --global to see all)`),
          );
        }

        // BUG-6: Warn about legacy unscoped suggestions
        if (currentProject) {
          const unscopedCount = allDeduped.filter(s => s.projects.length === 0).length;
          if (unscopedCount > 0) {
            console.log(
              chalk.yellow(`  ${unscopedCount} legacy suggestion${unscopedCount > 1 ? 's' : ''} lack${unscopedCount === 1 ? 's' : ''} project data. Run \`fbl analyze --last 30d --yes\` to re-analyze.`),
            );
          }
        }

        console.log();
      }

      // Community Insight
      if (frictionMap.size > 0) {
        const frictionTypes = [...frictionMap.keys()];
        const categories = analyses.flatMap((a) =>
          a.frictions.map((f: Friction) => f.category).filter(Boolean),
        ) as string[];
        const uniqueCategories = [...new Set(categories)];
        const recommendations = getCachedRecommendations();
        const rec = findRelevantRecommendation(frictionTypes, uniqueCategories, recommendations);
        console.log(chalk.bold('Community Insight'));
        if (rec) {
          console.log(
            `  ${chalk.magenta('→')} Devs who added ${rec.category} validation rules saw ${rec.impact_percent}% fewer ${rec.friction_type} frictions.`,
          );
        } else {
          console.log(
            chalk.dim('  No community data available yet. Run with telemetry enabled to contribute.'),
          );
        }
        console.log();
      }

      // Footer
      if (displayed.length > 0) {
        console.log(chalk.dim('Apply a suggestion: fbl apply <number>'));
        if (allDeduped.length > displayLimit) {
          console.log(chalk.dim('Suggestion numbers may change after new analyses. Use --dry-run before applying.'));
        }
      }
      console.log(chalk.dim('Full timeline: fbl history\n'));
    });
}

function severityRank(severity: 'low' | 'medium' | 'high'): number {
  switch (severity) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    case 'high':
      return 2;
  }
}
