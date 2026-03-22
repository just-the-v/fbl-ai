import { Command } from 'commander';
import { registerHookHandler } from '../src/cli/index.js';
import { registerAnalyzeCommand } from '../src/cli/analyze.js';
import { registerReportCommand } from '../src/cli/report.js';
import { registerApplyCommand } from '../src/cli/apply.js';
import { registerConfigCommand } from '../src/cli/config.js';
import { registerHistoryCommand } from '../src/cli/history.js';
import { registerGainCommand } from '../src/cli/gain.js';
import { registerInitCommand } from '../src/cli/init.js';

const program = new Command();

program
  .name('fbl')
  .description('Automated session analysis for Claude Code')
  .version('0.1.0');

registerHookHandler(program);
registerAnalyzeCommand(program);
registerReportCommand(program);
registerApplyCommand(program);
registerConfigCommand(program);
registerHistoryCommand(program);
registerGainCommand(program);
registerInitCommand(program);

program.parse();
