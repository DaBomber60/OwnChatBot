import { parseKeywords, entryMatches } from '../lib/lorebook/trigger';

describe('Lorebook trigger logic', () => {
  describe('parseKeywords', () => {
    it('parses space-separated keywords and normalizes them', () => {
      const keywords = parseKeywords('dragon SWORD   Magic');
      expect(keywords.size).toBe(3);
      expect(keywords.has('dragon')).toBe(true);
      expect(keywords.has('sword')).toBe(true);
      expect(keywords.has('magic')).toBe(true);
    });

    it('handles extra whitespace and empty strings', () => {
      const keywords = parseKeywords('  test   value  ');
      expect(keywords.size).toBe(2);
      expect(keywords.has('test')).toBe(true);
      expect(keywords.has('value')).toBe(true);
    });

    it('returns empty set for empty input', () => {
      const keywords = parseKeywords('');
      expect(keywords.size).toBe(0);
    });

    it('returns empty set for whitespace-only input', () => {
      const keywords = parseKeywords('   \t\n  ');
      expect(keywords.size).toBe(0);
    });
  });

  describe('entryMatches', () => {
    it('matches keywords as case-insensitive substrings', () => {
      const entry = { keys: 'dragon sword' };
      expect(entryMatches(entry, 'I saw a DRAGON')).toBe(true);
      expect(entryMatches(entry, 'The ancient sword')).toBe(true);
      expect(entryMatches(entry, 'SWORD-MASTER')).toBe(true);
    });

    it('does not match when no keywords present', () => {
      const entry = { keys: 'dragon sword' };
      expect(entryMatches(entry, 'I saw a horse')).toBe(false);
      expect(entryMatches(entry, 'Nothing relevant here')).toBe(false);
    });

    it('handles empty keywords gracefully', () => {
      const entry = { keys: '' };
      expect(entryMatches(entry, 'any text')).toBe(false);
    });

    it('matches multiple keywords in same message', () => {
      const entry = { keys: 'forest dark' };
      expect(entryMatches(entry, 'I entered a dark forest')).toBe(true);
    });

    it('does not require all keywords to match', () => {
      const entry = { keys: 'dragon sword magic' };
      expect(entryMatches(entry, 'I found a dragon')).toBe(true);
      expect(entryMatches(entry, 'The magic is strong')).toBe(true);
    });
  });

  describe('Lore injection', () => {
    it('builds constant lore section from entries', () => {
      const { buildConstantLoreSection } = require('../lib/lorebook/injection');
      const entries = [
        { id: 1, title: 'Dragon Lore', content: 'Dragons are...', priority: 100, constant: true, lorebookId: 1 },
      ];

      const section = buildConstantLoreSection(entries);
      expect(section).toContain('<lore_constant>');
      expect(section).toContain('Dragon Lore');
      expect(section).toContain('Dragons are...');
      expect(section).toContain('</lore_constant>');
    });

    it('returns empty string when no constant entries', () => {
      const { buildConstantLoreSection } = require('../lib/lorebook/injection');
      const section = buildConstantLoreSection([]);
      expect(section).toBe('');
    });

    it('builds triggered lore injection with marker and content', () => {
      const { buildTriggeredLoreInjection } = require('../lib/lorebook/injection');
      const entries = [
        { id: 1, title: 'Entry 1', content: 'Content 1', priority: 50, constant: false, lorebookId: 1 },
        { id: 2, title: 'Entry 2', content: 'Content 2', priority: 40, constant: false, lorebookId: 1 },
      ];

      const { marker, content, entryIds } = buildTriggeredLoreInjection(entries);
      expect(marker).toContain('[📖 Lore:');
      expect(marker).toContain('1');
      expect(marker).toContain('2');
      expect(content).toContain('<triggered_lore>');
      expect(content).toContain('Entry 1');
      expect(content).toContain('Entry 2');
      expect(entryIds).toEqual([1, 2]);
    });

    it('returns empty markers when no triggered entries', () => {
      const { buildTriggeredLoreInjection } = require('../lib/lorebook/injection');
      const { marker, content, entryIds } = buildTriggeredLoreInjection([]);
      expect(marker).toBe('');
      expect(content).toBe('');
      expect(entryIds).toEqual([]);
    });

    it('injects constant lore into system prompt', () => {
      const { injectConstantLoreIntoSystemPrompt } = require('../lib/lorebook/injection');
      const systemPrompt = 'System info\n\nThe following is a conversation between';
      const entries = [
        { id: 1, title: 'Lore', content: 'Content', priority: 100, constant: true, lorebookId: 1 },
      ];

      const result = injectConstantLoreIntoSystemPrompt(systemPrompt, entries);
      expect(result).toContain('<lore_constant>');
      expect(result).toContain('The following is a conversation between');
      expect(result.indexOf('<lore_constant>')).toBeLessThan(result.indexOf('The following is a conversation between'));
    });

    it('injects triggered lore into user message', () => {
      const { injectTriggeredLoreIntoUserMessage } = require('../lib/lorebook/injection');
      const message = 'User: I saw a dragon';
      const entries = [
        { id: 5, title: 'Dragon Lore', content: 'Dragons are ancient', priority: 100, constant: false, lorebookId: 1 },
      ];

      const { injectedMessage, triggeredIds } = injectTriggeredLoreIntoUserMessage(message, entries);
      expect(injectedMessage).toContain('User: I saw a dragon');
      expect(injectedMessage).toContain('[📖 Lore: 5]');
      expect(injectedMessage).toContain('<triggered_lore>');
      expect(triggeredIds).toEqual([5]);
    });
  });
});
