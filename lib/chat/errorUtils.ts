/**
 * Safely parse a Response as JSON, falling back to raw text.
 * Never throws — always returns an object.
 */
export async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    try {
      const text = await res.clone().text();
      return { __rawText: text } as any;
    } catch {
      return { __parseError: true } as any;
    }
  }
}

/** Mask values that look like API keys in error messages. */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return '';
  try {
    return msg.replace(/(api\s*key\s*:\s*)(\S+)/gi, (_, p1, key) => {
      const keep = 4;
      const masked = key.length > keep
        ? key.replace(new RegExp(`.(?=.{${keep}}$)`, 'g'), '*')
        : '****';
      return `${p1}${masked}`;
    });
  } catch {
    return msg;
  }
}

/** Extract a human-meaningful message from raw SSE / API error text. */
export function extractUsefulError(raw: string): string {
  if (!raw) return '';
  let msg = raw.trim();
  // Strip leading tag like [Stream]
  msg = msg.replace(/^\[[^\]]+\]\s*/, '');
  // Normalize common generic errors
  if (/input\s*stream/i.test(msg)) {
    return 'The AI stream was interrupted. Partial response was saved if available.';
  }
  // Prefer the part starting at "Authentication Fails"
  const auth = msg.match(/Authentication Fails[\s\S]*$/i);
  if (auth) return auth[0].trim();
  // Otherwise, drop up to the last colon
  const idx = msg.lastIndexOf(':');
  if (idx !== -1 && idx + 1 < msg.length) {
    return msg.slice(idx + 1).trim();
  }
  return msg;
}

/** Extract the useful error string from a raw Response or error data object. */
export function extractErrorFromResponse(errData: any, statusText?: string): string {
  const raw = (
    errData?.__rawText ||
    errData?.error?.message ||
    errData?.error ||
    statusText ||
    'Unknown error'
  ) as string;
  return sanitizeErrorMessage(extractUsefulError(String(raw)));
}
