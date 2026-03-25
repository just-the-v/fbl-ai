import { analyzeSession } from '../core/analyzer.js';
import { loadConfig, getDataDir } from '../storage/config.js';
import { storeAnalysis, isAlreadyAnalyzed } from '../storage/analyses.js';
import { loadSuggestionsIndex, saveSuggestionsIndex } from '../storage/suggestions.js';
import { resolveRepoRoot } from '../utils/git.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const [sessionId, transcriptPath, cwd] = process.argv.slice(2);

  if (!sessionId || !transcriptPath) {
    process.exit(1);
  }

  try {
    // 1. Load config
    const config = loadConfig();

    // 2. Check if already analyzed
    if (isAlreadyAnalyzed(sessionId)) return;

    // 3. Check transcript file exists
    if (!fs.existsSync(transcriptPath)) return;

    // 4. Analyze (resolve worktree paths to real repo root)
    const resolvedCwd = cwd ? resolveRepoRoot(cwd) : cwd;
    const analysis = await analyzeSession(transcriptPath, { config, projectPath: resolvedCwd });
    if (!analysis) return; // too short

    // 4. Store analysis
    storeAnalysis(analysis);

    // 5. Update suggestions index
    const index = loadSuggestionsIndex();
    for (const suggestion of analysis.suggestions) {
      index.push({
        ...suggestion,
        source_analysis: analysis.session_id,
        ...(analysis.project_path ? { project_path: analysis.project_path } : {}),
      });
    }
    saveSuggestionsIndex(index);

    // 6. TODO: telemetry (task 017)
  } catch (err) {
    // Log error to error.log, never crash
    const errorLog = path.join(getDataDir(), 'error.log');
    const entry = `[${new Date().toISOString()}] ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}\n\n`;
    fs.appendFileSync(errorLog, entry);
  }
}

main();
