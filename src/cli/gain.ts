import { Command } from 'commander';
import chalk from 'chalk';
import { listAnalyses } from '../storage/analyses.js';
import { getSuggestionsByStatus } from '../storage/suggestions.js';

/**
 * Get the ISO week number and year for a given date.
 * ISO weeks start on Monday.
 */
function getISOWeekData(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday (current date + 4 - current day number, with Sunday as 7)
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/**
 * Get the Monday of the ISO week for a given date.
 */
function getWeekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() - dayNum + 1); // Monday
  return d;
}

/**
 * Format a week range as "Mon DD-DD" or "Mon DD-Mon DD" for cross-month boundaries.
 */
function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const monMonth = monday.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const monDay = monday.getUTCDate().toString().padStart(2, '0');
  const sunMonth = sunday.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const sunDay = sunday.getUTCDate().toString().padStart(2, '0');

  if (monMonth === sunMonth) {
    return `${monMonth} ${monDay}-${sunDay}`;
  }
  return `${monMonth} ${monDay}-${sunMonth} ${sunDay}`;
}

/**
 * Build an ASCII bar chart string of given width, proportional to value/max.
 */
function buildBar(value: number, max: number, width: number = 10): string {
  if (max === 0) return '\u2591'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

interface WeekBucket {
  key: string; // "YYYY-WW"
  monday: Date;
  sessions: number;
  frictions: number;
}

export function registerGainCommand(program: Command): void {
  program
    .command('gain')
    .description('Show friction trend and improvement trajectory')
    .option('--weeks <n>', 'Number of weeks to display', '4')
    .action(async (opts: { weeks: string }) => {
      const numWeeks = parseInt(opts.weeks, 10);
      if (isNaN(numWeeks) || numWeeks < 1) {
        console.log(chalk.red('Invalid --weeks value. Must be a positive integer.'));
        return;
      }

      const analyses = listAnalyses();

      if (analyses.length === 0) {
        console.log(chalk.yellow('\nNo analyses yet. Run `fbl analyze --last 7d` first.\n'));
        return;
      }

      // Group analyses by ISO week
      const weekMap = new Map<string, WeekBucket>();

      for (const analysis of analyses) {
        const date = new Date(analysis.analyzed_at);
        const { year, week } = getISOWeekData(date);
        const key = `${year}-${week.toString().padStart(2, '0')}`;
        const monday = getWeekMonday(date);
        const frictionCount = analysis.frictions.reduce((s, f) => s + f.count, 0);

        if (!weekMap.has(key)) {
          weekMap.set(key, { key, monday, sessions: 0, frictions: 0 });
        }
        const bucket = weekMap.get(key)!;
        bucket.sessions += 1;
        bucket.frictions += frictionCount;
      }

      // Sort weeks descending and take last N
      const allWeeks = Array.from(weekMap.values()).sort((a, b) => b.key.localeCompare(a.key));
      const displayWeeks = allWeeks.slice(0, numWeeks).reverse(); // oldest first for display

      // Compute max avg for bar scaling
      const maxAvg = Math.max(...displayWeeks.map((w) => (w.sessions > 0 ? w.frictions / w.sessions : 0)));

      // Print friction trend table
      console.log(chalk.bold(`\n  Friction Trend (last ${numWeeks} weeks)`));
      console.log(chalk.dim('  ' + '\u2500'.repeat(55)));
      console.log(
        chalk.dim('  Week              Sessions  Frictions  Avg/session'),
      );

      for (const week of displayWeeks) {
        const avg = week.sessions > 0 ? week.frictions / week.sessions : 0;
        const bar = buildBar(avg, maxAvg);
        const weekLabel = formatWeekRange(week.monday).padEnd(16);
        const sessions = week.sessions.toString().padStart(5);
        const frictions = week.frictions.toString().padStart(8);
        const avgStr = avg.toFixed(1).padStart(8);

        console.log(`  ${weekLabel}  ${sessions}  ${frictions}  ${avgStr}  ${bar}`);
      }

      // Trajectory
      if (displayWeeks.length >= 2) {
        const oldestAvg = displayWeeks[0].sessions > 0 ? displayWeeks[0].frictions / displayWeeks[0].sessions : 0;
        const newestAvg =
          displayWeeks[displayWeeks.length - 1].sessions > 0
            ? displayWeeks[displayWeeks.length - 1].frictions / displayWeeks[displayWeeks.length - 1].sessions
            : 0;

        let trajectoryLabel: string;
        let pctChange: number;

        if (oldestAvg === 0) {
          pctChange = newestAvg === 0 ? 0 : 100;
        } else {
          pctChange = ((newestAvg - oldestAvg) / oldestAvg) * 100;
        }

        if (pctChange < -20) {
          trajectoryLabel = chalk.green(`improving (${Math.round(pctChange)}% avg frictions over ${numWeeks} weeks)`);
        } else if (pctChange > 20) {
          trajectoryLabel = chalk.red(`degrading (+${Math.round(pctChange)}% avg frictions over ${numWeeks} weeks)`);
        } else {
          trajectoryLabel = chalk.yellow(`stable (${pctChange >= 0 ? '+' : ''}${Math.round(pctChange)}% avg frictions over ${numWeeks} weeks)`);
        }

        console.log(`\n  ${chalk.bold('Trajectory:')} ${trajectoryLabel}`);
      } else {
        const uniqueWeeks = allWeeks.length;
        if (uniqueWeeks === 1) {
          console.log(`\n  ${chalk.bold('Trajectory:')} ${chalk.yellow('stable (all sessions in a single week — analyze over multiple weeks for trend)')}`);
        } else {
          console.log(`\n  ${chalk.bold('Trajectory:')} ${chalk.yellow('stable (not enough data)')}`);
        }
      }

      // Top friction types
      const frictionTypeCounts = new Map<string, number>();
      for (const analysis of analyses) {
        for (const f of analysis.frictions) {
          frictionTypeCounts.set(f.type, (frictionTypeCounts.get(f.type) ?? 0) + f.count);
        }
      }

      const sortedTypes = Array.from(frictionTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      if (sortedTypes.length > 0) {
        const maxTypeCount = sortedTypes[0][1];

        console.log(chalk.bold('\n  Top friction types'));
        console.log(chalk.dim('  ' + '\u2500'.repeat(40)));

        for (const [type, count] of sortedTypes) {
          const bar = buildBar(count, maxTypeCount);
          console.log(`  ${type.padEnd(22)} ${bar}  ${count}`);
        }
      }

      // Suggestion stats
      const applied = getSuggestionsByStatus('applied').length;
      const pending = getSuggestionsByStatus('pending').length;

      console.log(`\n  ${chalk.bold('Suggestions:')} ${applied} applied, ${pending} pending`);
      console.log(`  ${chalk.bold('Total sessions:')} ${analyses.length}`);
      console.log();
    });
}
