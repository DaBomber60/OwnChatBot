import {
  keywordMatches, normalizeKeywords, parseKeywordList, serializeKeywords, splitKeywordInput,
} from '../lib/lorebook/keywords';
import { entryMatches } from '../lib/lorebook/trigger';
import { readLoreSettings } from '../lib/lorebook/settings';

const whole = (text: string) => ({ text, wholeWord: true });
const part = (text: string) => ({ text, wholeWord: false });

describe('lore keywords', () => {
  it('normalizes: trims, collapses spaces, dedupes ignoring case, drops empty and overlong', () => {
    expect(normalizeKeywords(['  Dark   Forest ', whole('dark forest'), '', 'Dragon', 42, 'x'.repeat(101)]))
      .toEqual([part('Dark Forest'), part('Dragon')]);
    expect(normalizeKeywords(['cat'], true)).toEqual([whole('cat')]);
  });

  it('round-trips multi-word keywords and their match mode through storage', () => {
    const stored = serializeKeywords([whole('dark forest'), part('Silver Citadel')]);
    expect(parseKeywordList(stored)).toEqual([whole('dark forest'), part('Silver Citadel')]);
  });

  it('reads older formats as part-word keywords, which is how they always matched', () => {
    expect(parseKeywordList('dragon  sword')).toEqual([part('dragon'), part('sword')]);
    expect(parseKeywordList('["dark forest"]')).toEqual([part('dark forest')]);
    expect(parseKeywordList('[not json')).toEqual([part('[not'), part('json')]);
    expect(parseKeywordList(null)).toEqual([]);
  });

  it('splits typed input on commas and new lines, keeping spaces inside a keyword', () => {
    expect(splitKeywordInput('dark forest, castle\nold king,,', true))
      .toEqual([whole('dark forest'), whole('castle'), whole('old king')]);
  });

  describe('matching', () => {
    it('whole-word keywords do not fire inside longer words', () => {
      expect(keywordMatches(whole('cat'), 'The CAT sat down.')).toBe(true);
      expect(keywordMatches(whole('cat'), 'cat-like reflexes')).toBe(true);
      expect(keywordMatches(whole('cat'), 'concatenate the strings')).toBe(false);
      expect(keywordMatches(whole('cat'), 'two cats')).toBe(false);
      expect(keywordMatches(whole('café'), 'meet at the Café.')).toBe(true);
      expect(keywordMatches(whole('café'), 'cafés')).toBe(false);
    });

    it('part-word keywords also fire inside longer words', () => {
      expect(keywordMatches(part('cat'), 'concatenate the strings')).toBe(true);
      expect(keywordMatches(part('dragon'), 'Dragons!')).toBe(true);
    });

    it('matches multi-word keywords as a phrase across any whitespace', () => {
      expect(keywordMatches(whole('dark forest'), 'into the Dark\n  Forest')).toBe(true);
      expect(keywordMatches(whole('dark forest'), 'it was dark in the forest')).toBe(false);
    });

    it('treats regex characters in keywords literally', () => {
      expect(keywordMatches(part('c++'), 'I write C++ daily')).toBe(true);
      expect(keywordMatches(part('a.b'), 'axb')).toBe(false);
    });

    it('checks every keyword stored on an entry', () => {
      const entry = { keys: serializeKeywords([whole('cat'), part('dragon')]) };
      expect(entryMatches(entry, 'concatenate')).toBe(false);
      expect(entryMatches(entry, 'dragonfire')).toBe(true);
      expect(entryMatches(entry, '')).toBe(false);
    });
  });
});

describe('readLoreSettings', () => {
  it('uses defaults when unset and clamps stored values', () => {
    expect(readLoreSettings(undefined)).toEqual({ loreLimit: 20000, keepActiveTurns: 5, globalLoreDefault: true });
    expect(readLoreSettings({ loreLimit: '999999', loreKeepActiveTurns: '-4', globalLoreEnabled: 'false' }))
      .toEqual({ loreLimit: 50000, keepActiveTurns: 0, globalLoreDefault: false });
    expect(readLoreSettings({ loreLimit: 'abc' }).loreLimit).toBe(20000);
  });
});
