import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getCachedRecommendations,
  findRelevantRecommendation,
  type Recommendation,
} from '../recommendations.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-loop-rec-test-'));
  process.env.FBL_DATA_DIR = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FBL_DATA_DIR;
});

function makeCacheDir(): string {
  const cacheDir = path.join(tmpDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

const sampleRecs: Recommendation[] = [
  {
    friction_type: 'wrong_approach',
    category: 'architecture',
    recommendation: 'Add architecture decision records',
    impact_percent: 35,
  },
  {
    friction_type: 'buggy_code',
    category: 'testing',
    recommendation: 'Add unit test coverage',
    impact_percent: 42,
  },
  {
    friction_type: 'missing_context',
    category: 'documentation',
    recommendation: 'Improve onboarding docs',
    impact_percent: 28,
  },
];

describe('getCachedRecommendations', () => {
  it('returns [] when no cache', () => {
    expect(getCachedRecommendations()).toEqual([]);
  });

  it('reads from cache file', () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, 'recommendations.json'),
      JSON.stringify(sampleRecs, null, 2),
    );
    const result = getCachedRecommendations();
    expect(result).toEqual(sampleRecs);
    expect(result).toHaveLength(3);
  });
});

describe('findRelevantRecommendation', () => {
  it('matches by type+category', () => {
    const result = findRelevantRecommendation(
      ['buggy_code', 'wrong_approach'],
      ['testing'],
      sampleRecs,
    );
    expect(result).toEqual(sampleRecs[1]); // buggy_code + testing
  });

  it('falls back to type only', () => {
    const result = findRelevantRecommendation(
      ['missing_context'],
      ['unknown_category'],
      sampleRecs,
    );
    expect(result).toEqual(sampleRecs[2]); // missing_context, no category match
  });

  it('returns null if no match', () => {
    const result = findRelevantRecommendation(
      ['scope_bloat'],
      ['security'],
      sampleRecs,
    );
    expect(result).toBeNull();
  });
});
