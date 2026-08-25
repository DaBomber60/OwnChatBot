/**
 * Simple secret redaction helpers to prevent accidental leakage of API keys, tokens,
 * passwords, or Authorization headers in application logs.
 *
 * Usage: wrap any log arguments with redactAll(...args) or call safeLog(...args).
 * Only minimal patterns are implemented; extend as needed.
 */

const PROVIDER_KEY_PATTERN = /\b(?:sk|pk|rk|ak)[-_](?:proj|ant|live|test)?[-_]?[A-Za-z0-9_-]{16,}/g;
const AUTH_BEARER_PATTERN = /((?:Authorization\s*[:=]\s*)?\b(?:Bearer|Basic)\s+)([A-Za-z0-9._\-+/=]+)/gi;
const KEY_FIELD_PATTERN = /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|password)["']?\s*[:=]\s*["']?)([^"'\s,;}]{6,})/gi;
const KEY_HEADER_PATTERN = /((?:x-)?api[_-]?key\s*[:=]\s*)([^\s,;"']{6,})/gi;
// Last resort for opaque tokens the targeted patterns miss. Deliberately long to avoid
// mangling hashes, ids and ordinary prose in captured request/response bodies.
const GENERIC_TOKEN_PATTERN = /\b[A-Za-z0-9]{32,}\b/g;
const DB_URL_PATTERN = /(postgres(?:ql)?:\/\/)([^:\n\r@]+):([^@\n\r]+)@/gi;

/** Keeps the first and last 4 characters so a redacted value stays identifiable in logs. */
function mask(match: string): string {
  if (match.length <= 8) return '****';
  return match.slice(0, 4) + '****REDACTED****' + match.slice(-4);
}

export function redactString(input: unknown): string {
  if (input == null) return '';
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  if (typeof s !== 'string') return '';
  // Targeted patterns run first; the generic sweep must not eat their prefixes.
  s = s.replace(AUTH_BEARER_PATTERN, (_, p1) => `${p1}****REDACTED****`);
  s = s.replace(KEY_HEADER_PATTERN, (_, p1) => `${p1}****REDACTED****`);
  s = s.replace(KEY_FIELD_PATTERN, (_, p1) => `${p1}****REDACTED****`);
  s = s.replace(PROVIDER_KEY_PATTERN, mask);
  s = s.replace(DB_URL_PATTERN, (_, proto, user) => `${proto}${user}:****REDACTED****@`);
  s = s.replace(GENERIC_TOKEN_PATTERN, mask);
  return s;
}

export function redactAll(...args: unknown[]): string[] {
  return args.map(a => redactString(a));
}

export function safeLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...redactAll(...args));
}

// Optional: expose helper to patch console globally if ever desired.
export function patchConsoleForRedaction(): void {
  const origLog = console.log;
  if ((console as any).__redactionPatched) return;
  console.log = (...args: any[]) => origLog(...redactAll(...args));
  (console as any).__redactionPatched = true;
}
