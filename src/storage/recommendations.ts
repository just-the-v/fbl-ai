import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from './config.js';

export interface Recommendation {
  friction_type: string;
  category: string;
  recommendation: string;
  impact_percent: number;
}

const RECOMMENDATIONS_URL = process.env.FBL_RECOMMENDATIONS_URL || process.env.FEEDBACK_LOOP_RECOMMENDATIONS_URL ||
  'https://api.feedback-loop.dev/v1/recommendations';

function getCachePath(): string {
  return path.join(getDataDir(), 'cache', 'recommendations.json');
}

function getEtagPath(): string {
  return path.join(getDataDir(), 'cache', 'recommendations_etag.txt');
}

export function getCachedRecommendations(): Recommendation[] {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return [];
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return data as Recommendation[];
  } catch {
    return [];
  }
}

export async function fetchRecommendations(): Promise<Recommendation[]> {
  const cachePath = getCachePath();
  const etagPath = getEtagPath();

  // Check if cache is fresh (< 7 days)
  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const age = Date.now() - stat.mtimeMs;
      if (age < 7 * 24 * 60 * 60 * 1000) {
        return getCachedRecommendations();
      }
    }
  } catch { /* continue to fetch */ }

  // Fetch with ETag
  try {
    const headers: Record<string, string> = {};
    if (fs.existsSync(etagPath)) {
      headers['If-None-Match'] = fs.readFileSync(etagPath, 'utf-8').trim();
    }

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    const res = await fetch(RECOMMENDATIONS_URL, { headers, signal: controller.signal });

    if (res.status === 304) {
      // Not modified, touch the cache to reset the 7-day timer
      if (fs.existsSync(cachePath)) {
        const now = new Date();
        fs.utimesSync(cachePath, now, now);
      }
      return getCachedRecommendations();
    }

    if (res.ok) {
      const data = await res.json() as Recommendation[];
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));

      const etag = res.headers.get('etag');
      if (etag) fs.writeFileSync(etagPath, etag);

      return data;
    }
  } catch {
    // Fetch failed, use cache
  }

  return getCachedRecommendations();
}

export function findRelevantRecommendation(
  frictionTypes: string[],
  categories: string[],
  recommendations: Recommendation[]
): Recommendation | null {
  // Find a recommendation that matches the user's frictions
  for (const rec of recommendations) {
    if (frictionTypes.includes(rec.friction_type) && categories.includes(rec.category)) {
      return rec;
    }
  }
  // Fallback: match by friction type only
  for (const rec of recommendations) {
    if (frictionTypes.includes(rec.friction_type)) {
      return rec;
    }
  }
  return null;
}
