import { truncateMessagesIfNeeded, MessageForTruncation } from '../lib/messageUtils';

// Suppress console.log/warn noise during tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function msg(role: string, content: string): MessageForTruncation {
  return { role, content };
}

describe('truncateMessagesIfNeeded', () => {
  it('returns original messages when under the limit', () => {
    const messages = [msg('system', 'Hello'), msg('user', 'Hi'), msg('assistant', 'Hey')];
    const result = truncateMessagesIfNeeded(messages, 100000);
    expect(result.wasTruncated).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(result.messages).toBe(messages); // same reference
  });

  it('returns original messages when exactly at the limit', () => {
    const content = 'x'.repeat(50);
    const messages = [msg('system', content), msg('user', content)];
    const result = truncateMessagesIfNeeded(messages, 100);
    expect(result.wasTruncated).toBe(false);
    expect(result.removedCount).toBe(0);
  });

  it('truncates oldest non-system messages when over the limit', () => {
    const system = msg('system', 'sys'); // 3 chars
    const old1 = msg('user', 'old message 1'); // 13 chars
    const old2 = msg('assistant', 'old message 2'); // 13 chars
    const recent = msg('user', 'recent'); // 6 chars
    const messages = [system, old1, old2, recent];
    // total = 3 + 13 + 13 + 6 = 35
    // limit 10 → only system(3) + recent(6) = 9 fits
    const result = truncateMessagesIfNeeded(messages, 10);
    expect(result.wasTruncated).toBe(true);
    expect(result.removedCount).toBe(2);
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[1]!.content).toBe('recent');
  });

  it('preserves system message even if it alone exceeds the limit', () => {
    const system = msg('system', 'x'.repeat(200));
    const user = msg('user', 'hello');
    const result = truncateMessagesIfNeeded([system, user], 50);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.role).toBe('system');
  });

  it('returns empty array without crashing when given empty input', () => {
    const result = truncateMessagesIfNeeded([], 100);
    expect(result.messages).toEqual([]);
    expect(result.wasTruncated).toBe(false);
    expect(result.removedCount).toBe(0);
  });

  it('preserves chronological order after truncation', () => {
    const system = msg('system', 'S');
    const msgs = Array.from({ length: 10 }, (_, i) => msg('user', `msg-${i}`));
    const all = [system, ...msgs];
    // system = 1 char, each msg is 5 chars ("msg-X")
    // limit = 1 + 5*3 = 16 → system + last 3 messages
    const result = truncateMessagesIfNeeded(all, 16);
    expect(result.wasTruncated).toBe(true);
    expect(result.messages.length).toBe(4); // system + 3 newest
    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[1]!.content).toBe('msg-7');
    expect(result.messages[2]!.content).toBe('msg-8');
    expect(result.messages[3]!.content).toBe('msg-9');
  });

  it('uses default maxCharacters of 150000', () => {
    const messages = [msg('system', 'x'.repeat(100)), msg('user', 'y'.repeat(100))];
    const result = truncateMessagesIfNeeded(messages);
    expect(result.wasTruncated).toBe(false); // 200 < 150000
  });

  it('handles single system message only', () => {
    const result = truncateMessagesIfNeeded([msg('system', 'only')], 1000);
    expect(result.wasTruncated).toBe(false);
    expect(result.messages.length).toBe(1);
  });

  it('drops all non-system messages if each individually exceeds remaining budget', () => {
    const system = msg('system', 'sys'); // 3 chars
    const big1 = msg('user', 'x'.repeat(100));
    const big2 = msg('assistant', 'y'.repeat(100));
    // limit 10 → only 7 chars left for non-system, but each is 100
    const result = truncateMessagesIfNeeded([system, big1, big2], 10);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.role).toBe('system');
    expect(result.removedCount).toBe(2);
  });
});
