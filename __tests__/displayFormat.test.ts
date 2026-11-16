import { formatRelativeTime, textSnippet } from '../lib/displayFormat';

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();
  const ago = (seconds: number) => now - seconds * 1000;

  it('describes recent times in the largest sensible unit', () => {
    expect(formatRelativeTime(ago(10), now)).toBe('just now');
    expect(formatRelativeTime(ago(5 * 60), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(26 * 3600), now)).toBe('yesterday');
    expect(formatRelativeTime(ago(3 * 86400), now)).toBe('3 days ago');
    expect(formatRelativeTime(ago(15 * 86400), now)).toBe('2 weeks ago');
    expect(formatRelativeTime(ago(70 * 86400), now)).toBe('2 months ago');
    expect(formatRelativeTime(ago(800 * 86400), now)).toBe('2 years ago');
  });

  it('accepts ISO strings and ignores invalid dates', () => {
    expect(formatRelativeTime('2026-11-16T11:00:00Z', now)).toBe('1 hour ago');
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});

describe('textSnippet', () => {
  it('flattens whitespace and leaves short text alone', () => {
    expect(textSnippet('  A quiet\n\nevening  ')).toBe('A quiet evening');
    expect(textSnippet(null)).toBe('');
  });

  it('cuts long text at a word boundary', () => {
    expect(textSnippet('The ranked climb continues through the night', 20)).toBe('The ranked climb…');
  });
});
