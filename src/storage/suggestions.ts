import * as fs from 'node:fs';
import * as path from 'node:path';
import { SuggestionSchema, type Suggestion } from '../core/schema.js';
import { getDataDir, ensureDataDirs } from './config.js';
import { z } from 'zod';

const SuggestionIndexItemSchema = SuggestionSchema.extend({
  source_analysis: z.string(),
  applied_at: z.string().optional(),
  project_path: z.string().optional(),
});

export type SuggestionIndexItem = z.infer<typeof SuggestionIndexItemSchema>;

function getIndexPath(): string {
  return path.join(getDataDir(), 'suggestions', 'index.json');
}

export function loadSuggestionsIndex(): SuggestionIndexItem[] {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) return [];
  const raw = fs.readFileSync(indexPath, 'utf-8');
  return JSON.parse(raw) as SuggestionIndexItem[];
}

export function saveSuggestionsIndex(suggestions: SuggestionIndexItem[]): void {
  ensureDataDirs();
  const indexPath = getIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(suggestions, null, 2), 'utf-8');
}

export function getSuggestionsByStatus(status: 'pending' | 'applied' | 'dismissed'): SuggestionIndexItem[] {
  const all = loadSuggestionsIndex();
  return all.filter((s) => s.status === status);
}

export function updateSuggestionStatus(
  id: string,
  status: 'pending' | 'applied' | 'dismissed',
  applied_at?: string,
): void {
  const suggestions = loadSuggestionsIndex();
  const idx = suggestions.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error(`Suggestion ${id} not found`);
  suggestions[idx].status = status;
  if (applied_at) {
    suggestions[idx].applied_at = applied_at;
  }
  saveSuggestionsIndex(suggestions);
}

export function getNextPendingSuggestionNumber(): number {
  const pending = getSuggestionsByStatus('pending');
  return pending.length + 1;
}

export type DisplaySuggestion = SuggestionIndexItem & { sessionCount: number; projects: string[] };

function confidenceRank(level: 'high' | 'medium' | 'low'): number {
  switch (level) {
    case 'high': return 2;
    case 'medium': return 1;
    case 'low': return 0;
  }
}

/**
 * Extract significant words from a string (lowercase, length >= 3).
 */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/**
 * Compute word overlap ratio between two strings.
 * Uses Jaccard-like similarity: common / min(len) to be more lenient
 * when one suggestion is longer than the other.
 */
function wordSimilarity(a: string, b: string): number {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.length === 0 && wordsB.length === 0) return 1;
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setB = new Set(wordsB);
  const common = wordsA.filter((w) => setB.has(w)).length;
  // Use min instead of max to be more lenient when lengths differ
  return common / Math.min(wordsA.length, wordsB.length);
}

/**
 * Extract a normalized category from the rule text.
 * Returns the first 2-3 significant words as a proxy for category.
 */
function extractCategory(rule: string): string {
  const words = significantWords(rule);
  // Return first 3 words as a rough category fingerprint
  return words.slice(0, 3).sort().join(' ');
}

/**
 * Check whether two suggestions should be merged.
 * Criteria (any match triggers merge):
 * 1. Word similarity > 40% (lowered from 50%)
 * 2. Same target type + overlapping category keywords (>= 2 common significant words)
 */
function shouldMerge(a: SuggestionIndexItem, b: SuggestionIndexItem): boolean {
  // Must share the same target
  if (a.target !== b.target) return false;

  // Direct word similarity check (lowered threshold)
  if (wordSimilarity(a.rule, b.rule) > 0.4) return true;

  // Target-based category grouping: if same target and share >= 2 significant words
  const wordsA = new Set(significantWords(a.rule));
  const wordsB = significantWords(b.rule);
  const commonWords = wordsB.filter((w) => wordsA.has(w));
  if (commonWords.length >= 2) return true;

  return false;
}

/**
 * Deduplicate suggestions by target + rule similarity.
 * For each group, keeps the suggestion with the highest confidence
 * and enriches it with a sessionCount based on distinct source analyses.
 */
export function deduplicateSuggestions(
  suggestions: SuggestionIndexItem[],
): DisplaySuggestion[] {
  const groups: { representative: SuggestionIndexItem; sources: Set<string>; projects: Set<string> }[] = [];

  for (const s of suggestions) {
    let merged = false;
    for (const group of groups) {
      if (shouldMerge(group.representative, s)) {
        group.sources.add(s.source_analysis);
        if (s.project_path) group.projects.add(s.project_path);
        if (confidenceRank(s.confidence) > confidenceRank(group.representative.confidence)) {
          group.representative = s;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      const projects = new Set<string>();
      if (s.project_path) projects.add(s.project_path);
      groups.push({
        representative: s,
        sources: new Set([s.source_analysis]),
        projects,
      });
    }
  }

  return groups.map((g) => ({
    ...g.representative,
    sessionCount: g.sources.size,
    projects: [...g.projects],
  }));
}

/**
 * Get display-ready suggestions: pending, deduplicated, sorted by confidence desc.
 * Used by both report and apply to ensure consistent numbering.
 */
export function getDisplaySuggestions(limit?: number, projectFilter?: string): DisplaySuggestion[] {
  const pending = getSuggestionsByStatus('pending');
  let deduped = deduplicateSuggestions(pending)
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));

  if (projectFilter) {
    // Show suggestions that are either:
    // 1. From this specific project (project-scoped)
    // 2. Global (appears in 2+ projects)
    // 3. Unscoped (projects is empty — legacy suggestions without project_path)
    deduped = deduped.filter(s =>
      s.projects.includes(projectFilter) || s.projects.length >= 2 || s.projects.length === 0
    );
  }

  if (limit !== undefined && limit > 0) {
    return deduped.slice(0, limit);
  }
  return deduped;
}
