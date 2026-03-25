import { execSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Resolve a directory path to the real git repo root, handling worktrees.
 * When running inside a git worktree, `git rev-parse --show-toplevel` returns
 * the worktree root (ephemeral), not the main repo root. This function uses
 * `--git-common-dir` to find the shared .git directory and derive the real root.
 */
export function resolveRepoRoot(cwd: string): string {
  try {
    const commonDir = execSync(`git -C "${cwd}" rev-parse --git-common-dir`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // If commonDir is just ".git", we're in the main worktree already
    if (commonDir === '.git') {
      return execSync(`git -C "${cwd}" rev-parse --show-toplevel`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    }

    // commonDir is an absolute path like /real/repo/.git or /real/repo/.git/worktrees/name
    // Resolve to absolute if relative
    const absCommonDir = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(cwd, commonDir);

    // Walk up to find the .git directory (handles .git/worktrees/name paths)
    let dir = absCommonDir;
    while (path.basename(dir) !== '.git' && dir !== path.dirname(dir)) {
      dir = path.dirname(dir);
    }

    if (path.basename(dir) === '.git') {
      return path.dirname(dir);
    }

    // Fallback: use --show-toplevel
    return execSync(`git -C "${cwd}" rev-parse --show-toplevel`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return cwd;
  }
}
