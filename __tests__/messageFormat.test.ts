/**
 * @jest-environment jsdom
 */
import { sanitizeMessage, formatMessage } from '../lib/messageFormat';

// ---------------------------------------------------------------------------
// sanitizeMessage
// ---------------------------------------------------------------------------
describe('sanitizeMessage', () => {
  it('strips <script> tags', () => {
    expect(sanitizeMessage('<script>alert("xss")</script>Hello')).toBe('Hello');
  });

  it('strips <img> tags', () => {
    expect(sanitizeMessage('<img src="x" onerror="alert(1)">text')).toBe('text');
  });

  it('strips <style> tags', () => {
    expect(sanitizeMessage('<style>body{display:none}</style>visible')).toBe('visible');
  });

  it('keeps allowed tags', () => {
    const input = '<b>bold</b> <em>italic</em> <code>code</code>';
    expect(sanitizeMessage(input)).toBe(input);
  });

  it('keeps <a> tags with href', () => {
    const input = '<a href="https://example.com">link</a>';
    const result = sanitizeMessage(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('link</a>');
  });

  it('strips disallowed attributes', () => {
    const result = sanitizeMessage('<span onclick="alert(1)">text</span>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('text');
  });

  it('handles null/undefined input', () => {
    expect(sanitizeMessage(null as any)).toBe('');
    expect(sanitizeMessage(undefined as any)).toBe('');
  });

  it('preserves plain text', () => {
    expect(sanitizeMessage('Hello, world!')).toBe('Hello, world!');
  });
});

// ---------------------------------------------------------------------------
// formatMessage
// ---------------------------------------------------------------------------
describe('formatMessage', () => {
  it('converts inline code', () => {
    expect(formatMessage('use `console.log`')).toContain('<code>console.log</code>');
  });

  it('converts bold text', () => {
    expect(formatMessage('**bold text**')).toContain('<strong>bold text</strong>');
  });

  it('converts italic text', () => {
    const result = formatMessage('some *italic* text');
    expect(result).toContain('<em>italic</em>');
  });

  it('converts newlines to <br>', () => {
    expect(formatMessage('line1\nline2')).toContain('<br>');
  });

  it('handles \\r\\n newlines', () => {
    expect(formatMessage('line1\r\nline2')).toContain('<br>');
  });

  it('returns empty string for empty input', () => {
    expect(formatMessage('')).toBe('');
  });

  it('returns empty string for falsy input', () => {
    expect(formatMessage(null as any)).toBe('');
    expect(formatMessage(undefined as any)).toBe('');
  });

  it('sanitizes XSS embedded in markdown', () => {
    const input = '**<script>alert(1)</script>bold**';
    const result = formatMessage(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('<strong>');
  });

  it('handles mixed markdown', () => {
    const input = '**bold** and *italic* and `code`';
    const result = formatMessage(input);
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<code>code</code>');
  });
});
