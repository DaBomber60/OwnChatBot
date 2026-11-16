// Small display helpers for timestamps and text previews.

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  // unit, seconds per unit, switch to the next unit at this many of the current one
  ['minute', 60, 45],
  ['hour', 3600, 22],
  ['day', 86400, 6],
  ['week', 604800, 4],
  ['month', 2629800, 11],
  ['year', 31557600, Infinity],
];

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"... */
export function formatRelativeTime(date: Date | string | number, now: number = Date.now()): string {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  for (const [unit, size, limit] of UNITS) {
    const value = Math.round(seconds / size);
    if (Math.abs(value) < limit) return relativeFormat.format(value, unit);
  }
  return '';
}

/** First part of a text on one line, cut at a word boundary. CSS line-clamping handles the visual fit. */
export function textSnippet(text: string | null | undefined, maxLength = 240): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}
