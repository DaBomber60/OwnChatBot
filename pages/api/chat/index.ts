import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { badRequest, notFound, serverError, tooManyRequests } from '../../../lib/apiErrors';
import { clampMaxTokens, stripThinkTags } from '../../../lib/aiProvider';
import { startUpstreamRequest, type UpstreamRequestHandle } from '../../../lib/upstreamAI';
import {
  resolveAIConfig, isThinkingEnabled, buildUpstreamBody, buildConversationPrompt,
  persistRequestWithMeta, loadUserPromptBody, parseUpstreamBody, forwardUpstreamError,
} from '../../../lib/aiRequest';
import { relayUpstreamSSE } from '../../../lib/sseRelay';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { enforceBodySize } from '../../../lib/bodyLimit';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { persistJsonResponse, persistSseResponse } from '../../../lib/apiLog';
const CONTINUE_PREFIX = '[SYSTEM NOTE: Ignore this message';
const isContinuationPlaceholder = (msg?: string) => !!msg && msg.startsWith(CONTINUE_PREFIX);

export default withApiHandler({}, {
  POST: async (req: NextApiRequest, res: NextApiResponse) => {

  // Get API key from database settings
  // Basic per-IP rate limiting (Item 10). Limits bursts of generation attempts.
  const ip = clientIp(req as any);
  const rl = limiters.chatGenerate(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Rate limit exceeded for chat generation', 'RATE_LIMITED', rl.retryAfterSeconds);
  }
  // Enforce max JSON body size (e.g., 1MB) for chat generation inputs
  if (!enforceBodySize(req as any, res, 1 * 1024 * 1024)) return;
  // Resolve AI provider configuration (api key, base URL, model)
  const aiCfg = await resolveAIConfig(res);
  if (!aiCfg) return;
  const { truncationLimit } = aiCfg;
  const isDeepSeekThinking = isThinkingEnabled(aiCfg);
  // Validate request body via Zod schema
  const parsed = validateBody(schemas.chatGenerate, req, res);
  if (!parsed) return;
  const {
    sessionId,
    personaId,
    characterId,
    temperature = 1,
    stream = true,
    maxTokens,
    userMessage,
    userPromptId,
    retry = false
  } = parsed as any;

  // determine session
  let sessionIdToUse = sessionId;
  if (!sessionIdToUse) {
    if (!personaId || !characterId) return badRequest(res, 'Missing personaId or characterId', 'MISSING_IDS');
    const newSession = await prisma.chatSession.create({ data: { personaId, characterId } });
    sessionIdToUse = newSession.id;
  }

  // persist new user message (skip any continuation system placeholder variants + retry scenarios)
  // Track created user message so we can roll it back if user aborts before any assistant content arrives
  let createdUserMessageId: number | null = null;
  let userMessageRolledBack = false; // prevent double deletion / race
  if (userMessage && !isContinuationPlaceholder(userMessage) && !retry) {
    const created = await prisma.chatMessage.create({ data: { sessionId: sessionIdToUse, role: 'user', content:  userMessage } });
    createdUserMessageId = created.id;
    // Update session's updatedAt timestamp
    await prisma.chatSession.update({
      where: { id: sessionIdToUse },
      data: { updatedAt: new Date() }
    });
  }

  // load session details
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionIdToUse },
    include: { persona: true, character: true }
  });
  if (!session) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
  const { persona, character } = session;

  // fetch global user prompt if provided
  const userPromptBody = userPromptId ? await loadUserPromptBody(userPromptId) : '';

  // fetch full message history from DB
  const historyRaw = await prisma.chatMessage.findMany({
    where: { sessionId: sessionIdToUse },
    orderBy: { createdAt: 'asc' }
  });
  // Filter out any persisted continuation placeholders from older sessions
  const history = historyRaw.filter((m: { role: string; content: string; }) => !(m.role === 'user' && isContinuationPlaceholder(m.content)));
  console.log(`[History] Loaded full DB history: ${history.length} messages for session ${sessionIdToUse}`);

  // System prompt + persona-prefixed history, truncated, with thinking guidance applied.
  // The continuation directive is appended AFTER truncation so it can never be dropped.
  const prompt = buildConversationPrompt({
    cfg: aiCfg,
    persona,
    character,
    history,
    summary: session.summary,
    userPromptBody,
  });
  if (prompt.wasTruncated) {
    console.log(`[Truncation] Removed ${prompt.removedCount} messages (${prompt.baseMessages.length} -> ${prompt.messages.length})`);
  }

  // Now, if this is a continuation request, append the ephemeral continuation directive as the LAST message.
  // This guarantees it's kept (not subject to truncation) and not prefixed with persona name.
  if (isContinuationPlaceholder(userMessage)) {
  console.log('[Continuation] Continuation request detected. Appending ephemeral continuation user message AFTER truncation.');
    prompt.messages.push({ role: 'user', content: userMessage });
  }

  // Compute max_tokens: use per-request override from body, else batched config value
  let computedMaxTokens: number | undefined;
  if (typeof maxTokens === 'number') {
    computedMaxTokens = clampMaxTokens(maxTokens);
  } else if (typeof maxTokens === 'string') {
    const parsed = parseInt(maxTokens, 10);
    computedMaxTokens = isNaN(parsed) ? aiCfg.maxTokens : clampMaxTokens(parsed);
  } else {
    computedMaxTokens = aiCfg.maxTokens;
  }

  const body = buildUpstreamBody(aiCfg, {
    messages: prompt.messages,
    stream,
    temperature,
    maxTokens: computedMaxTokens,
  });

  await persistRequestWithMeta(sessionIdToUse, body, prompt, truncationLimit);

  // (Removed verbose full JSON debug logging per user request)
  const DEBUG_CAPTURE = process.env.DEBUG_CHAT_CAPTURE === 'true' || process.env.DEBUG_FULL_CHAT_LOG === 'true';

  // Helper function to save assistant message (concatenate if last message is also assistant)
  const saveAssistantMessage = async (content: string) => {
    if (!content.trim()) return; // nothing visible to save

    // Fetch the latest message (correct order desc) instead of earliest
    const lastMessage = await prisma.chatMessage.findFirst({
      where: { sessionId: sessionIdToUse },
      orderBy: { createdAt: 'desc' }
    });

    // Decide whether to append or create a new message.
    // Append if:
    //  - The last DB message is assistant AND
    //    a) this is a redo/continue flow with no real userMessage OR
    //    b) the provided userMessage is a continuation placeholder (ephemeral directive)
    const shouldAppend = !!lastMessage && lastMessage.role === 'assistant' && (
      !userMessage || isContinuationPlaceholder(userMessage)
    );

    if (shouldAppend) {
  console.log('[Append] Appending to previous assistant message');
      await prisma.chatMessage.update({
        where: { id: lastMessage!.id },
        data: { content: lastMessage!.content + '\n\n' + content }
      });
    } else {
      await prisma.chatMessage.create({
        data: {
          sessionId: sessionIdToUse,
            role: 'assistant',
          content
        }
      });
    }

    await prisma.chatSession.update({
      where: { id: sessionIdToUse },
      data: { updatedAt: new Date() }
    });
  };

  let upstream: UpstreamRequestHandle;
  try {
    upstream = await startUpstreamRequest(aiCfg, { body, streaming: stream, logLabel: '[Stream]' });
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      return serverError(res, 'Upstream model request aborted', 'UPSTREAM_ABORTED');
    }
    throw err;
  }
  const apiRes = upstream.response;

  if (!stream) {
    upstream.stopTimer();
    // Capture entire body text for debug, then parse JSON
    const rawText = await apiRes.text();
    if (DEBUG_CAPTURE) {
      console.log('[Upstream][non-stream] Raw body:', rawText);
    }
    const data = parseUpstreamBody(rawText);
    // Persist last API response payload for download (store raw and parsed)
    await persistJsonResponse(sessionIdToUse, apiRes, rawText, data && !data.__rawText ? data : undefined);
    // If upstream failed, return a structured error
    if (apiRes.status >= 400) {
      return forwardUpstreamError(res, apiRes.status, data, rawText, '[Chat][non-stream]');
    }
    // save AI response
    if (data.choices && data.choices[0]?.message?.content) {
      // Strip <think> tags before saving to DB (non-streaming path)
      const contentToSave = isDeepSeekThinking ? stripThinkTags(data.choices[0].message.content) : data.choices[0].message.content;
      if (contentToSave.trim()) await saveAssistantMessage(contentToSave);
      // Strip <think> tags from non-streaming response sent to client
      if (isDeepSeekThinking) {
        data.choices[0].message.content = contentToSave;
      }
    } else if (data.error) {
      console.error('[Upstream][non-stream] Error payload:', data.error);
    } else if (data.__rawText) {
      console.warn('[Upstream][non-stream] Non-JSON/unknown payload captured.');
    }
    // Return original body to the client if it was valid JSON; else return raw text
    try {
      // If we parsed JSON successfully, return it; otherwise send text
      if (data && !data.__rawText) {
        return res.status(apiRes.status).json(data);
      }
      res.setHeader('Content-Type', 'application/json');
      return res.status(apiRes.status).send(rawText);
    } catch {
      return res.status(apiRes.status).send(rawText);
    }
  }

  // STREAMING
  const upstreamCT = apiRes.headers.get('content-type') || '';
  const upstreamIsSSE = upstreamCT.includes('text/event-stream');
  if (!upstreamIsSSE) {
    upstream.stopTimer();
    // Upstream did not return SSE; capture and forward as non-stream error/response
    const rawText = await apiRes.text();
    if (DEBUG_CAPTURE) {
      console.warn('[Upstream] Expected SSE but received non-SSE content-type:', upstreamCT);
      console.log('[Upstream][non-SSE in stream mode] Raw body:', rawText);
    }
    let data: any;
    try { data = JSON.parse(rawText); } catch { data = { __rawText: rawText }; }
    // Persist last API response payload for download
    await persistJsonResponse(sessionIdToUse, apiRes, rawText, data && !data.__rawText ? data : undefined);
    // If upstream failed, return structured error
    if (apiRes.status >= 400) {
      return forwardUpstreamError(res, apiRes.status, data, rawText, '[Chat][stream-mode non-SSE]');
    }
    // Optionally save content if present even in non-SSE reply
    if (data && data.choices && data.choices[0]?.message?.content) {
      const contentToSave = isDeepSeekThinking ? stripThinkTags(data.choices[0].message.content) : data.choices[0].message.content;
      if (contentToSave.trim()) await saveAssistantMessage(contentToSave);
      if (isDeepSeekThinking) data.choices[0].message.content = contentToSave;
    } else if (data && data.content) {
      const contentToSave = isDeepSeekThinking ? stripThinkTags(data.content) : data.content;
      if (contentToSave.trim()) await saveAssistantMessage(contentToSave);
      if (isDeepSeekThinking) data.content = contentToSave;
    } else if (data && data.error) {
      console.error('[Upstream][non-SSE in stream mode] Error payload:', data.error);
    }
    // Forward response body as-normal
    try {
      if (data && !data.__rawText) {
        return res.status(apiRes.status).json(data);
      }
      res.setHeader('Content-Type', 'application/json');
      return res.status(apiRes.status).send(rawText);
    } catch {
      return res.status(apiRes.status).send(rawText);
    }
  }

  // Downstream SSE headers only if we got SSE upstream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  // Send initial connection message
  res.write('data: {"status":"connected"}\n\n');

  // Heartbeat to keep intermediaries (e.g., proxies/CDNs) from timing out idle streams
  // Use small JSON data frames (more reliable across HTTP/3/CDNs than comment lines)
  const HEARTBEAT_INTERVAL_MS = 10000; // 10s to satisfy stricter H3/CDN idle windows
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const startHeartbeat = () => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      try {
        if (!res.destroyed && res.writable) {
          // Minimal data frame clients can ignore
          res.write('data: {"__hb":1}\n\n');
        } else if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      } catch {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  startHeartbeat();

  const reader = apiRes.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }
  
  let assistantText = '';
  let assistantThinkingText = '';   // Thinking/reasoning content for logs only
  let streamCompleted = false;
  let messageSaved = false;            // Indicates content persisted (full or partial)
  let clientDisconnected = false;
  let partialSaveInitiated = false;    // Guard to prevent double partial save attempts
  // Optional capture of raw SSE payloads for debugging
  const sseCapture: string[] | null = DEBUG_CAPTURE ? [] : null;
  // Always capture frames for persistence
  const responseFrames: string[] = [];

  // Helper function to save partial message (idempotent)
  const savePartialMessage = async (reason: string) => {
    if (partialSaveInitiated || messageSaved) return; // already saving or saved
    if (!assistantText.trim()) return; // nothing to save
    // Optimistic lock BEFORE awaiting DB to avoid race between 'close' and 'aborted'
    partialSaveInitiated = true;
  console.log(`[Partial] Saving partial message due to ${reason}:`, assistantText.substring(0, 100) + '...');
    try {
      await saveAssistantMessage(assistantText);
      messageSaved = true;
    } catch (error) {
      console.error('Error saving partial message:', error);
    }
  };
  
  const handleEarlyClose = async (label: string) => {
    if (clientDisconnected) return; // ensure single execution path
  console.log(`[Stream] ${label} during streaming`);
    clientDisconnected = true;
  stopHeartbeat();
    upstream.dispose(label);
    if (!streamCompleted) {
      await savePartialMessage(label);
      // If NO assistant content streamed and we created a user message this request, roll it back
      if (!assistantText.trim() && createdUserMessageId && !userMessageRolledBack) {
        try {
          const result = await prisma.chatMessage.deleteMany({ where: { id: createdUserMessageId } });
          if (result.count > 0) {
            console.log(`[Rollback] Deleted user message ${createdUserMessageId} due to early abort with no assistant content`);
          } else {
            console.log(`[Rollback] Early abort: user message ${createdUserMessageId} already absent (idempotent)`);
          }
        } catch (e) {
          console.error('[Rollback] Failed to delete early-aborted user message (unexpected)', e);
        } finally {
          createdUserMessageId = null;
          userMessageRolledBack = true;
        }
      }
    }
  };

  req.on('close', () => { void handleEarlyClose('client disconnect'); });
  req.on('aborted', () => { void handleEarlyClose('request aborted'); });
  
  // Function to check if we can still write to response
  const canWriteToResponse = () => {
    try {
      return !clientDisconnected && !res.destroyed && res.writable;
    } catch {
      return false;
    }
  };
  
  try {
    const relay = await relayUpstreamSSE({
      reader,
      res,
      thinkingEnabled: isDeepSeekThinking,
      canWrite: canWriteToResponse,
      logLabel: '[Stream]',
      onFrame: (payload) => {
        responseFrames.push(payload);
        if (sseCapture) sseCapture.push(payload);
      },
      onChunk: () => upstream.keepAlive(),
      onProgress: async (s) => {
        await persistSseResponse(sessionIdToUse, apiRes, {
          frames: s.frames.slice(-100),
          completed: false,
          assistantText: s.assistantText,
          assistantThinkingText: s.assistantThinkingText,
        });
      },
      onReadError: async (_err, s) => {
        // Keep whatever streamed before the failure so it can be persisted
        assistantText = s.assistantText;
        assistantThinkingText = s.assistantThinkingText;
        await savePartialMessage('reader error');
      },
    });
    stopHeartbeat();
    upstream.stopTimer();
    assistantText = relay.assistantText;
    assistantThinkingText = relay.assistantThinkingText;
    if (relay.sawDone) streamCompleted = true;
    if (relay.writeFailed) clientDisconnected = true;
    
    // Mark stream as completed only if we didn't detect a disconnect
  if (!clientDisconnected) {
      streamCompleted = true;
      console.log('[Stream] Completed normally. chunks=%d bytes=%d assistantLen=%d', relay.totalChunks, relay.totalBytes, assistantText.length);
    } else {
      console.log('[Stream] Stream stopped due to client disconnect. chunks=%d bytes=%d assistantLen=%d', relay.totalChunks, relay.totalBytes, assistantText.length);
    }
    if (DEBUG_CAPTURE && sseCapture && sseCapture.length) {
      try {
        console.log('[Stream][Capture] First 20 frames:', sseCapture.slice(0, 20));
        if (sseCapture.length > 20) console.log('[Stream][Capture] Total frames:', sseCapture.length);
      } catch {}
    }
    
    // Save complete message only if we completed normally and haven't saved a partial yet
    if (!messageSaved && !clientDisconnected && assistantText.trim()) {
      await saveAssistantMessage(assistantText);
      messageSaved = true;
    } else if (!assistantText.trim() && !clientDisconnected) {
      console.warn('[Stream] Completed normally but assistantText was empty; nothing to save');
    } else if (clientDisconnected && !messageSaved) {
      // Fallback (should normally already be saved by disconnect handler)
      await savePartialMessage('post-disconnect finalize');
    }
    // Final safety: if stream ended (abort or otherwise) with zero assistant content AND user aborted (clientDisconnected)
    // and we still have an unrolled user message, delete it.
    if (clientDisconnected && !assistantText.trim() && createdUserMessageId && !userMessageRolledBack) {
      try {
        const result = await prisma.chatMessage.deleteMany({ where: { id: createdUserMessageId } });
        if (result.count > 0) {
          console.log(`[Rollback] Deleted user message ${createdUserMessageId} in finalize (no assistant content)`);
        } else {
          console.log(`[Rollback] Finalize: user message ${createdUserMessageId} already absent (idempotent)`);
        }
      } catch (e) {
        console.error('[Rollback] Finalize deletion failed (unexpected)', e);
      } finally {
        createdUserMessageId = null;
        userMessageRolledBack = true;
      }
    }
    
  } catch (error) {
    console.error('Streaming error:', error);
    // Save partial message if we have content and haven't completed
    if (!streamCompleted && !messageSaved) {
      await savePartialMessage('stream error');
    }
  }
  
  stopHeartbeat();

  // Tear down the upstream connection so the provider can't keep sending after we're done
  upstream.dispose('stream finished');
  try { await reader.cancel(); } catch {}

  // Persist last API response for SSE (frames and summary)
  await persistSseResponse(sessionIdToUse, apiRes, {
    frames: responseFrames,
    completed: streamCompleted && !clientDisconnected,
    assistantText,
    assistantThinkingText,
  });

  // Only end response if it's still writable
  if (canWriteToResponse()) {
    try {
      // If we never emitted [DONE] (e.g., upstream closed without it), emit a terminal marker so clients exit cleanly
      if (!streamCompleted) {
        res.write('data: [DONE]\n\n');
      }
    } catch {}
    res.end();
  }
  },
});
