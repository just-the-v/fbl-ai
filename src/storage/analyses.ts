import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionAnalysisSchema, type SessionAnalysis } from '../core/schema.js';
import { getDataDir, ensureDataDirs } from './config.js';

function getAnalysesDir(): string {
  return path.join(getDataDir(), 'analyses');
}

export function storeAnalysis(analysis: SessionAnalysis): void {
  ensureDataDirs();
  const date = analysis.analyzed_at.slice(0, 10); // YYYY-MM-DD
  const shortId = analysis.session_id.slice(0, 8);
  const filename = `${date}-${shortId}.json`;
  const filePath = path.join(getAnalysesDir(), filename);
  fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2), 'utf-8');
}

export function listAnalyses(filter?: { since?: Date; until?: Date }): SessionAnalysis[] {
  const dir = getAnalysesDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const analyses: SessionAnalysis[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const parsed = SessionAnalysisSchema.parse(JSON.parse(raw));
    analyses.push(parsed);
  }

  let result = analyses;

  if (filter?.since) {
    const since = filter.since.getTime();
    result = result.filter((a) => new Date(a.analyzed_at).getTime() >= since);
  }
  if (filter?.until) {
    const until = filter.until.getTime();
    result = result.filter((a) => new Date(a.analyzed_at).getTime() <= until);
  }

  result.sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime());
  return result;
}

export function getAnalysis(sessionId: string): SessionAnalysis | undefined {
  const dir = getAnalysesDir();
  if (!fs.existsSync(dir)) return undefined;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.session_id === sessionId) {
      return SessionAnalysisSchema.parse(parsed);
    }
  }
  return undefined;
}

export function isAlreadyAnalyzed(sessionId: string): boolean {
  return getAnalysis(sessionId) !== undefined;
}
