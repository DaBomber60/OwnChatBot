jest.mock('../lib/prisma', () => ({ __esModule: true, default: {} }));

import {
  parseKeywords,
  entryMatches,
  recentlyMatchedLoreIds,
  selectActiveEntries,
  selectConstantEntries,
  type LoreEntryRow,
} from '../lib/lorebook/trigger';
import {
  buildConstantLoreSection,
  buildTriggeredLoreInjection,
  injectConstantLoreIntoSystemPrompt,
  injectTriggeredLoreIntoUserMessage,
  appendTriggeredLoreToLastUserMessage,
} from '../lib/lorebook/injection';
import { latestUserMessageText } from '../lib/lorebook/integration';
import { buildConversationPrompt } from '../lib/aiRequest';
import { serializeLoreMetadata } from '../lib/messageMetadata';
import type { AIConfig } from '../lib/aiProvider';

function row(overrides: Partial<LoreEntryRow> & { id: number }): LoreEntryRow {
  return {
    lorebookId: 1,
    title: `Entry ${overrides.id}`,
    content: `Content ${overrides.id}`,
    keys: '',
    constant: false,
    priority: 100,
    ...overrides,
  };
}

const assistant = (matched: number[] = [], triggered: number[] = matched) => ({
  role: 'assistant',
  metadata: serializeLoreMetadata(triggered, matched),
});
const user = { role: 'user', metadata: null };

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

    it('does not require all keywords to match', () => {
      const entry = { keys: 'dragon sword magic' };
      expect(entryMatches(entry, 'I found a dragon')).toBe(true);
      expect(entryMatches(entry, 'The magic is strong')).toBe(true);
    });
  });

  describe('recentlyMatchedLoreIds (keep-active window)', () => {
    it('collects keyword matches from the last N assistant replies, counting turns not messages', () => {
      const history = [assistant([1]), user, assistant([2]), user, assistant([3]), user];
      expect([...recentlyMatchedLoreIds(history, 2)].sort()).toEqual([2, 3]);
      expect([...recentlyMatchedLoreIds(history, 3)].sort()).toEqual([1, 2, 3]);
    });

    it('ignores entries that were only kept active, so they expire unless their keywords come up again', () => {
      // Entry 7 matched once, then rode along as kept-active on the next reply.
      const history = [assistant([7]), user, assistant([], [7]), user];
      expect(recentlyMatchedLoreIds(history, 1).has(7)).toBe(false);
      expect(recentlyMatchedLoreIds(history, 2).has(7)).toBe(true);
    });

    it('returns nothing when keep-active is disabled', () => {
      expect(recentlyMatchedLoreIds([assistant([1]), user], 0).size).toBe(0);
    });

    it('tolerates messages without metadata', () => {
      expect(recentlyMatchedLoreIds([{ role: 'assistant' }, user], 3).size).toBe(0);
    });
  });

  describe('selectActiveEntries', () => {
    const entries = [
      row({ id: 1, keys: 'dragon', priority: 50 }),
      row({ id: 2, keys: 'castle', priority: 200 }),
      row({ id: 3, keys: 'dragon', constant: true }),
      row({ id: 4, keys: 'forest' }),
    ];

    it('includes new keyword matches and kept-active entries, highest priority first', () => {
      const { entries: active, matchedIds } = selectActiveEntries(entries, 'A dragon appears', new Set([2]), 10000);
      expect(active.map(e => e.id)).toEqual([2, 1]);
      expect(matchedIds).toEqual([1]);
    });

    it('never selects constant entries (they live in the system prompt)', () => {
      const { entries: active } = selectActiveEntries(entries, 'dragon', new Set([3]), 10000);
      expect(active.map(e => e.id)).not.toContain(3);
    });

    it('fills the lore budget by priority, skipping entries that do not fit', () => {
      const budgeted = [
        row({ id: 10, keys: 'x', priority: 300, content: 'a'.repeat(60) }),
        row({ id: 11, keys: 'x', priority: 200, content: 'b'.repeat(60) }),
        row({ id: 12, keys: 'x', priority: 100, content: 'c'.repeat(30) }),
      ];
      const { entries: active, matchedIds } = selectActiveEntries(budgeted, 'x', new Set(), 100);
      expect(active.map(e => e.id)).toEqual([10, 12]);
      // A match that didn't fit isn't recorded, so it can't linger via keep-active.
      expect(matchedIds).toEqual([10, 12]);
    });

    it('injects nothing when the lore limit is 0', () => {
      expect(selectActiveEntries(entries, 'dragon castle', new Set(), 0).entries).toEqual([]);
    });
  });

  describe('selectConstantEntries', () => {
    it('returns constant entries by priority and ignores constants in the global lorebook', () => {
      const constants = selectConstantEntries([
        row({ id: 1, constant: true, priority: 10 }),
        row({ id: 2, constant: true, priority: 90 }),
        row({ id: 3, constant: true, lorebookId: 0 }),
        row({ id: 4, constant: false }),
      ]);
      expect(constants.map(e => e.id)).toEqual([2, 1]);
    });
  });

  describe('latestUserMessageText', () => {
    it('finds the most recent user message (continuations reuse it)', () => {
      expect(latestUserMessageText([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'reply 2' },
      ])).toBe('second');
      expect(latestUserMessageText([{ role: 'assistant', content: 'hi' }])).toBe('');
    });
  });
});

describe('Lore injection', () => {
  const constant = row({ id: 1, title: 'Dragon Lore', content: 'Dragons are ancient', constant: true });
  const triggered = row({ id: 5, title: 'Castle', content: 'The castle is old' });

  it('builds constant lore section from entries', () => {
    const section = buildConstantLoreSection([constant]);
    expect(section).toContain('<lore_constant>');
    expect(section).toContain('Dragon Lore');
    expect(section).toContain('Dragons are ancient');
    expect(buildConstantLoreSection([])).toBe('');
  });

  it('builds the triggered lore block without sending entry IDs to the model', () => {
    const { content, entryIds } = buildTriggeredLoreInjection([triggered]);
    expect(content).toContain('<triggered_lore>');
    expect(content).toContain('[Entry: Castle]');
    expect(content).not.toContain('📖');
    expect(entryIds).toEqual([5]);
    expect(buildTriggeredLoreInjection([])).toEqual({ content: '', entryIds: [] });
  });

  it('injects constant lore before the conversation marker', () => {
    const result = injectConstantLoreIntoSystemPrompt('System info\n\nThe following is a conversation between', [constant]);
    expect(result.indexOf('<lore_constant>')).toBeLessThan(result.indexOf('The following is a conversation between'));
  });

  it('appends triggered lore to a user message', () => {
    const { injectedMessage, triggeredIds } = injectTriggeredLoreIntoUserMessage('Ann: I see a castle', [triggered]);
    expect(injectedMessage.startsWith('Ann: I see a castle\n\n<triggered_lore>')).toBe(true);
    expect(triggeredIds).toEqual([5]);
  });

  it('appends triggered lore only to the last user message, without mutating the input', () => {
    const messages = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ];
    const result = appendTriggeredLoreToLastUserMessage(messages, [triggered]);
    expect(result[0]!.content).toBe('one');
    expect(result[2]!.content).toContain('three\n\n<triggered_lore>');
    expect(result[3]!.content).toBe('four');
    expect(messages[2]!.content).toBe('three');
    expect(appendTriggeredLoreToLastUserMessage(messages, [])).toBe(messages);
  });
});

describe('buildConversationPrompt with lore', () => {
  const cfg: AIConfig = {
    apiKey: 'k', provider: 'openai', url: 'http://localhost', model: 'm',
    temperature: 1, maxTokens: 1000, truncationLimit: 400000, summaryPrompt: '', apiFailureTimeout: 20,
    loreLimit: 4000, loreKeepActiveTurns: 3,
    deepseekThinking: 'disabled', deepseekReasoningEffort: 'high', deepseekThinkingGuidance: '',
  };
  const persona = { name: 'Ann', profile: 'A traveller' };
  const character = { name: 'Bob', personality: 'Gruff', scenario: 'A tavern', exampleDialogue: '' };
  const history = [
    { role: 'user', content: 'Tell me of dragons' },
    { role: 'assistant', content: 'They are old.' },
    { role: 'user', content: 'And the castle?' },
  ];
  const lore = {
    constantEntries: [row({ id: 1, title: 'World', content: 'The world is flat', constant: true })],
    triggeredEntries: [row({ id: 5, title: 'Castle', content: 'x'.repeat(500) })],
  };

  it('puts constant lore in the system prompt and triggered lore on the newest user turn', () => {
    const prompt = buildConversationPrompt({ cfg, persona, character, history, lore });
    const [system, firstUser, , lastUser] = prompt.messages;
    expect(system!.content).toContain('The world is flat');
    expect(firstUser!.content).toBe('Ann: Tell me of dragons');
    expect(lastUser!.content.startsWith('Ann: And the castle?\n\n<triggered_lore>')).toBe(true);
  });

  it('counts lore toward the truncation limit', () => {
    const withoutLore = buildConversationPrompt({ cfg, persona, character, history });
    const size = withoutLore.messages.reduce((n, m) => n + m.content.length, 0);
    const tight = { ...cfg, truncationLimit: size + 50 };

    expect(buildConversationPrompt({ cfg: tight, persona, character, history }).wasTruncated).toBe(false);
    expect(buildConversationPrompt({ cfg: tight, persona, character, history, lore }).wasTruncated).toBe(true);
  });
});
