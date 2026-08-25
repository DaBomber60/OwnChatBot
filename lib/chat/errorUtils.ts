import { redactString } from '../redact';

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

/** Longest technical detail we'll render; a provider can return a whole HTML page. */
const MAX_DETAIL_LENGTH = 500;

/**
 * Normalise raw upstream or exception text for the modal's detail block: strips our own
 * log prefix, redacts secrets with the shared server patterns, and caps the length.
 * The message is shown in full — it sits under purpose-written copy, so nothing is gained
 * by guessing which fragment matters.
 */
export function toErrorDetail(raw: unknown): string {
  if (raw == null) return '';
  let msg = (typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '').trim();
  if (!msg) return '';
  msg = msg.replace(/^\[[^\]]+\]\s*/, '');
  if (/input\s*stream/i.test(msg)) {
    return 'The AI stream was interrupted, so the half-written reply was discarded.';
  }
  msg = redactString(msg).trim();
  return msg.length > MAX_DETAIL_LENGTH ? `${msg.slice(0, MAX_DETAIL_LENGTH)}…` : msg;
}

/** Extract the useful error string from a parsed error body. */
export function extractErrorFromResponse(errData: any, statusText?: string): string {
  const raw =
    errData?.error?.message ??
    (typeof errData?.error === 'string' ? errData.error : undefined) ??
    errData?.__rawText ??
    statusText ??
    'Unknown error';
  return toErrorDetail(raw);
}
