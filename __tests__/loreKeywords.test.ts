import { normalizeKeywords, parseKeywordList, serializeKeywords, splitKeywordInput } from '../lib/lorebook/keywords';
import { entryMatches, parseKeywords } from '../lib/lorebook/trigger';
import { readLoreSettings } from '../lib/lorebook/settings';

describe('lore keywords', () => {
  it('normalizes: trims, collapses spaces, dedupes ignoring case, drops empty and overlong', () => {
    expect(normalizeKeywords(['  Dark   Forest ', 'dark forest', '', 'Dragon', 42, 'x'.repeat(101)]))
      .toEqual(['Dark Forest', 'Dragon']);
  });

  it('round-trips multi-word keywords through storage', () => {
    const stored = serializeKeywords(['dark forest', 'Silver Citadel']);
    expect(parseKeywordList(stored)).toEqual(['dark forest', 'Silver Citadel']);
  });

  it('still reads legacy space-separated keys', () => {
    expect(parseKeywordList('dragon  sword')).toEqual(['dragon', 'sword']);
    expect(parseKeywordList('[not json')).toEqual(['[not', 'json']);
    expect(parseKeywordList(null)).toEqual([]);
  });

  it('splits typed input on commas and new lines, keeping spaces inside a keyword', () => {
    expect(splitKeywordInput('dark forest, castle\nold king,,')).toEqual(['dark forest', 'castle', 'old king']);
  });

  it('matches a multi-word keyword as a phrase, not as separate words', () => {
    const entry = { keys: serializeKeywords(['dark forest']) };
    expect(entryMatches(entry, 'We walked into the Dark Forest at dusk')).toBe(true);
    expect(entryMatches(entry, 'It was dark in the forest')).toBe(false);
    expect([...parseKeywords(entry.keys)]).toEqual(['dark forest']);
  });
});

describe('readLoreSettings', () => {
  it('uses defaults when unset and clamps stored values', () => {
    expect(readLoreSettings(undefined)).toEqual({ loreLimit: 4000, keepActiveTurns: 3, globalLoreDefault: true });
    expect(readLoreSettings({ loreLimit: '999999', loreKeepActiveTurns: '-4', globalLoreEnabled: 'false' }))
      .toEqual({ loreLimit: 50000, keepActiveTurns: 0, globalLoreDefault: false });
    expect(readLoreSettings({ loreLimit: 'abc' }).loreLimit).toBe(4000);
  });
});
