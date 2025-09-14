/**
 * Simple secret redaction helpers to prevent accidental leakage of API keys, tokens,
 * passwords, or Authorization headers in application logs.
 *
 * Usage: wrap any log arguments with redactAll(...args) or call safeLog(...args).
 * Only minimal patterns are implemented; extend as needed.
 */

const API_KEY_PATTERN = /(?:(?:sk|pk|rk|ak)_[A-Za-z0-9]{16,}|[A-Za-z0-9]{24,})/g; // heuristic long tokens
const AUTH_BEARER_PATTERN = /(Authorization:\s*Bearer\s+)([A-Za-z0-9._\-]+)/gi;
const DB_URL_PATTERN = /(postgres(?:ql)?:\/\/)([^:\n\r@]+):([^@\n\r]+)@/i; // redact password portion

export function redactString(input: unknown): string {
  if (input == null) return '';
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  // Authorization headers
  s = s.replace(AUTH_BEARER_PATTERN, (_, p1) => `${p1}****REDACTED****`);
  // Generic API-like tokens (avoid over-redacting by masking middle)
  s = s.replace(API_KEY_PATTERN, (match) => {
    if (match.length <= 8) return '****';
    return match.slice(0, 4) + '****REDACTED****' + match.slice(-4);
  });
  // DB URL password
  s = s.replace(DB_URL_PATTERN, (_, proto, user) => `${proto}${user}:****REDACTED****@`);
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
