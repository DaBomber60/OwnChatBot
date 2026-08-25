import prisma from './prisma';
import { redactString } from './redact';

/** Guards against a runaway provider filling the row; the log is a debugging aid, not an archive. */
const MAX_PERSISTED_BYTES = 256 * 1024;

function serialiseCapped(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PERSISTED_BYTES) return json;
  return JSON.stringify({
    ...payload,
    __truncated: true,
    __originalBytes: json.length,
    bodyText: undefined,
    body: undefined,
    frames: undefined,
  });
}

/**
 * Extract response headers into a plain object.
 */
function extractHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = redactString(v); });
  return headers;
}

/**
 * Persist the outgoing AI request payload (with truncation metadata) for debugging/download.
 */
export async function persistApiRequest(
  sessionId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiRequest" = ${serialiseCapped(payload)} WHERE id = ${sessionId}`;
  } catch (e) {
    console.error('Failed to persist lastApiRequest', e);
  }
}

/**
 * Persist a JSON (non-streaming) AI response for debugging/download.
 */
export async function persistJsonResponse(
  sessionId: number,
  response: Response,
  rawText: string,
  parsedBody?: unknown,
): Promise<void> {
  try {
    const failed = response.status >= 400;
    const toStore = {
      mode: 'json',
      upstreamStatus: response.status,
      headers: extractHeaders(response),
      // Only error bodies plausibly echo credentials; redacting a success body would
      // corrupt the conversation text this log exists to explain.
      bodyText: failed ? redactString(rawText) : rawText,
      body: failed ? undefined : parsedBody ?? undefined,
    };
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiResponse" = ${serialiseCapped(toStore)} WHERE id = ${sessionId}`;
  } catch (e) {
    console.error('Failed to persist lastApiResponse (json)', e);
  }
}

/**
 * Persist an SSE (streaming) AI response snapshot or final state for debugging/download.
 */
export async function persistSseResponse(
  sessionId: number,
  response: Response,
  opts: {
    frames: string[];
    completed: boolean;
    assistantText: string;
    assistantThinkingText?: string;
  },
): Promise<void> {
  try {
    const toStore: Record<string, unknown> = {
      mode: 'sse',
      upstreamStatus: response.status,
      headers: extractHeaders(response),
      frames: opts.frames,
      completed: opts.completed,
      assistantText: opts.assistantText,
    };
    if (opts.assistantThinkingText) {
      toStore.assistantThinkingText = opts.assistantThinkingText;
    }
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiResponse" = ${serialiseCapped(toStore)} WHERE id = ${sessionId}`;
  } catch (e) {
    console.error('Failed to persist lastApiResponse (sse)', e);
  }
}
