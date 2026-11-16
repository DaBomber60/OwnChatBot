/**
 * Lore entry keywords. Stored in lore_entries.keys as a JSON array so multi-word keywords
 * ("dark forest") survive; older rows hold space-separated single words. Client-safe.
 */

export const MAX_KEYWORD_LENGTH = 100;
export const MAX_KEYWORDS_PER_ENTRY = 100;

/** Trim, collapse inner whitespace, drop empties/overlong ones, and dedupe case-insensitively (first spelling wins). */
export function normalizeKeywords(keywords: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords) {
    if (typeof raw !== 'string') continue;
    const keyword = raw.trim().replace(/\s+/g, ' ');
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= MAX_KEYWORDS_PER_ENTRY) break;
  }
  return result;
}

export function serializeKeywords(keywords: readonly unknown[]): string {
  return JSON.stringify(normalizeKeywords(keywords));
}

/** Read stored keys: a JSON array, or the legacy space-separated format. */
export function parseKeywordList(stored: string | null | undefined): string[] {
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
export function splitKeywordInput(text: string): string[] {
  return normalizeKeywords(text.split(/[,\n]/));
}
