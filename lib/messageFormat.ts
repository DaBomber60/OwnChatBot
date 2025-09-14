import createDOMPurify from 'isomorphic-dompurify';

// Minimal markdown-ish formatting then sanitize
// - sanitizeMessage: strips unsafe tags/attrs and disallows <img>
// - formatMessage: apply basic markdown (**bold**, *italic*, `code`) then sanitize

const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'code', 'pre', 'br', 'hr', 'p', 'div', 'ul', 'ol', 'li', 'a', 'span'
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

export function sanitizeMessage(input: string): string {
  const DOMPurify = createDOMPurify();
  return DOMPurify.sanitize(input ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['img', 'script', 'style'],
  });
}

export function formatMessage(input: string): string {
  if (!input) return '';
  // Basic replacements: handle code first to avoid interfering with bold/italic inside code spans
  let html = input;
  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **text** (non-greedy)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (avoid matching bold markers)
  html = html.replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, (_m, pre, body) => `${pre}<em>${body}</em>`);
  // Convert lone newlines to <br>
  html = html.replace(/\r?\n/g, '<br>');

  return sanitizeMessage(html);
}

const MessageFormat = { sanitizeMessage, formatMessage };
export default MessageFormat;
