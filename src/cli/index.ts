import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigPath } from '../storage/config.js';

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  reason: string;
}

export function registerHookHandler(program: Command): void {
  program
    .command('hook-handler', { hidden: true })
    .description('Internal: handle Claude Code session-end hook')
    .action(async () => {
      // Read stdin entirely
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        process.exit(0);
      }

      let input: HookInput;
      try {
        input = JSON.parse(raw) as HookInput;
      } catch {
        process.exit(0);
      }

      const { session_id, transcript_path, cwd } = input;

      // Check config exists, exit silently if not
      const configPath = getConfigPath();
      if (!fs.existsSync(configPath)) {
        process.exit(0);
      }

      // Resolve worker path relative to this file's compiled location
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // In dist: dist/bin/fbl.js imports dist/bin/chunk with cli/index
      // Worker is at dist/hooks/worker.js
      // We need to find it relative to the project root
      const workerPath = path.resolve(__dirname, '..', 'hooks', 'worker.js');

      const child = spawn(process.execPath, [workerPath, session_id, transcript_path, cwd], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
      child.unref();
      process.exit(0);
    });
}
