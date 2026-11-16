/**
 * Lore entry keywords. Stored in lore_entries.keys as a JSON array of { text, wholeWord }.
 * Older rows hold a JSON array of strings or space-separated words; both read as part-word
 * matches, which is how they always behaved. Client-safe.
 */
import type { LoreKeyword } from '../../types/models';

export type { LoreKeyword };

export const MAX_KEYWORD_LENGTH = 100;
export const MAX_KEYWORDS_PER_ENTRY = 100;

/**
 * Trim, collapse inner whitespace, drop empties/overlong ones, and dedupe case-insensitively
 * (first one wins). Plain strings become keywords with `wholeWord: defaultWholeWord`.
 */
export function normalizeKeywords(keywords: readonly unknown[], defaultWholeWord = false): LoreKeyword[] {
  const seen = new Set<string>();
  const result: LoreKeyword[] = [];
  for (const raw of keywords) {
    let text: unknown;
    let wholeWord = defaultWholeWord;
    if (typeof raw === 'string') {
      text = raw;
    } else if (raw && typeof raw === 'object') {
      text = (raw as { text?: unknown }).text;
      wholeWord = (raw as { wholeWord?: unknown }).wholeWord === true;
    }
    if (typeof text !== 'string') continue;
    const keyword = text.trim().replace(/\s+/g, ' ');
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ text: keyword, wholeWord });
    if (result.length >= MAX_KEYWORDS_PER_ENTRY) break;
  }
  return result;
}

/** Plain strings are stored as part-word matches, matching the API's original behavior. */
export function serializeKeywords(keywords: readonly unknown[]): string {
  return JSON.stringify(normalizeKeywords(keywords));
}

/** Read stored keys: a JSON array, or the legacy space-separated format. */
export function parseKeywordList(stored: string | null | undefined): LoreKeyword[] {
  if (!stored) return [];
  const trimmed = stored.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeKeywords(parsed);
    } catch {
      // Not JSON after all; fall through to the legacy format.
    }
  }
  return normalizeKeywords(trimmed.split(/\s+/));
}

/** Split free-typed text into keywords on commas and new lines (spaces stay inside a keyword). */
export function splitKeywordInput(text: string, wholeWord: boolean): LoreKeyword[] {
  return normalizeKeywords(text.split(/[,\n]/), wholeWord);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Case-insensitive matcher for one keyword. Spaces inside a keyword match any run of whitespace.
 * Whole-word keywords can't sit inside a longer word: "cat" matches "the cat sat" but not "concatenate".
 */
export function keywordPattern(keyword: LoreKeyword): RegExp {
  const body = keyword.text.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return keyword.wholeWord
    ? new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu')
    : new RegExp(body, 'iu');
}

export function keywordMatches(keyword: LoreKeyword, text: string): boolean {
  return keywordPattern(keyword).test(text);
}
