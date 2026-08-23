// Shared implementation for the two summary endpoints (generate + update).
// They differ only in which messages are summarized, whether the existing
// summary is part of the system prompt, and the wording of the instruction.
import type { NextApiResponse } from 'next';
import prisma from './prisma';
import { notFound, serverError } from './apiErrors';
import { buildSystemPrompt, replacePlaceholders } from './systemPrompt';
import { truncateMessagesIfNeeded, injectTruncationNote } from './messageUtils';
import { callUpstreamAI } from './upstreamAI';
import { resolveAIConfig, buildUpstreamBody, type PromptMessage } from './aiRequest';

export interface SummaryRunResult {
  /** Text produced by this run. */
  generated: string;
  /** Existing summary with `generated` appended. */
  newSummary: string;
  /** Id of the newest message at the time of summarizing. */
  lastSummary: number | null;
  /** Messages fed to the model (all of them for `generate`). */
  summarizedCount: number;
}

export interface SummaryRunOptions {
  sessionId: number;
  /** 'generate' summarizes the whole session; 'update' only messages after `lastSummary`. */
  mode: 'generate' | 'update';
  /**
   * Select which messages to summarize and reject the request when there is
   * nothing to do. Return null after writing a response to abort the run.
   */
  selectMessages: (session: SessionWithMessages) => Array<{ id: number; role: string; content: string }> | null;
}

type SessionWithMessages = {
  id: number;
  summary: string | null;
  lastSummary: number | null;
  persona: any;
  character: any;
  messages: Array<{ id: number; role: string; content: string }>;
};

const UPDATE_PROMPT_SUFFIX = ', this summary should keep in mind the context of the summary values in the initial system prompt.';

/** Load a session with persona, character and ordered messages. */
export async function loadSessionForSummary(sessionId: number): Promise<SessionWithMessages | null> {
  return await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      persona: true,
      character: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
  }) as unknown as SessionWithMessages | null;
}

/**
 * Run a summary request end to end: build the prompt, call the provider, then
 * append the result to the session summary.
 * Returns null when a response has already been written (error or nothing to do).
 */
export async function runSummary(
  res: NextApiResponse,
  session: SessionWithMessages,
  opts: Omit<SummaryRunOptions, 'sessionId'>,
): Promise<SummaryRunResult | null> {
  const cfg = await resolveAIConfig(res);
  if (!cfg) return null;

  const messagesToSummarize = opts.selectMessages(session);
  if (!messagesToSummarize) return null;

  const { persona, character, messages } = session;

  // 'update' keeps the existing summary in context; 'generate' starts fresh.
  const systemContent = opts.mode === 'update'
    ? buildSystemPrompt(persona, character, { summary: session.summary || undefined })
    : buildSystemPrompt(persona, character);

  const processedSummaryPrompt = replacePlaceholders(cfg.summaryPrompt, persona.name, character.name);
  const instruction = opts.mode === 'update'
    ? `[System: ${processedSummaryPrompt}${UPDATE_PROMPT_SUFFIX}]`
    : `[System: ${processedSummaryPrompt}]`;

  const allMessages: PromptMessage[] = [
    { role: 'system', content: systemContent },
    ...messagesToSummarize.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: instruction },
  ];

  const truncationResult = truncateMessagesIfNeeded(allMessages, cfg.truncationLimit);
  injectTruncationNote(truncationResult);

  const body = buildUpstreamBody(cfg, { messages: truncationResult.messages, stream: false });
  const upstream = await callUpstreamAI({ url: cfg.url, apiKey: cfg.apiKey, body });

  if (!upstream.ok) {
    serverError(res, `API request failed: ${upstream.rawText || 'Unknown error'}`, 'UPSTREAM_API_ERROR');
    return null;
  }

  const generated: unknown = upstream.data?.choices?.[0]?.message?.content;
  if (typeof generated !== 'string' || !generated.trim()) {
    serverError(res, 'Invalid API response format', 'INVALID_UPSTREAM_FORMAT');
    return null;
  }

  const generatedText = generated.trim();
  const currentSummary = session.summary || '';
  const newSummary = currentSummary ? `${currentSummary}\n\n${generatedText}` : generatedText;
  const lastSummary = messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null;

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { summary: newSummary, lastSummary, updatedAt: new Date() },
  });

  return { generated: generatedText, newSummary, lastSummary, summarizedCount: messagesToSummarize.length };
}

/** Load the session or write a 404, returning null in that case. */
export async function requireSessionForSummary(res: NextApiResponse, sessionId: number): Promise<SessionWithMessages | null> {
  const session = await loadSessionForSummary(sessionId);
  if (!session) {
    notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    return null;
  }
  return session;
}
