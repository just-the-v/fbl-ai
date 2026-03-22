import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}. Use e.g. 7d, 30d, 24h.`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'm':
      return value * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export interface SessionFile {
  path: string;
  projectDir: string;
  projectPath: string; // decoded original path
  mtime: Date;
}

function decodeProjectDir(dirName: string): string {
  return dirName.replace(/-/g, '/');
}

export function getSessionFiles(projectDir?: string): SessionFile[] {
  const projectsDir = getClaudeProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const dirs = projectDir ? [projectDir] : fs.readdirSync(projectsDir);
  const results: SessionFile[] = [];

  for (const dir of dirs) {
    const fullDir = path.join(projectsDir, dir);
    if (!fs.statSync(fullDir).isDirectory()) continue;

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const stat = fs.statSync(filePath);
      results.push({
        path: filePath,
        projectDir: dir,
        projectPath: decodeProjectDir(dir),
        mtime: stat.mtime,
      });
    }
  }

  return results;
}

export function discoverSessions(duration: string): SessionFile[] {
  const ms = parseDuration(duration);
  const cutoff = new Date(Date.now() - ms);
  const allFiles = getSessionFiles();
  return allFiles
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
