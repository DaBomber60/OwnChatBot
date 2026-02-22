import prisma from './prisma';

/**
 * Extract response headers into a plain object.
 */
function extractHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
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
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiRequest" = ${JSON.stringify(payload)} WHERE id = ${sessionId}`;
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
    const toStore = {
      mode: 'json',
      upstreamStatus: response.status,
      headers: extractHeaders(response),
      bodyText: rawText,
      body: parsedBody ?? undefined,
    };
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiResponse" = ${JSON.stringify(toStore)} WHERE id = ${sessionId}`;
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
  },
): Promise<void> {
  try {
    const toStore = {
      mode: 'sse',
      upstreamStatus: response.status,
      headers: extractHeaders(response),
      frames: opts.frames,
      completed: opts.completed,
      assistantText: opts.assistantText,
    };
    await prisma.$executeRaw`UPDATE chat_sessions SET "lastApiResponse" = ${JSON.stringify(toStore)} WHERE id = ${sessionId}`;
  } catch (e) {
    console.error('Failed to persist lastApiResponse (sse)', e);
  }
}
