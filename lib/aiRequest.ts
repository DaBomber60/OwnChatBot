// Shared building blocks for server-side AI generation requests.
// Used by chat generation, variant generation and summary generation so the
// prompt assembly / request shape / upstream error handling stay identical.
import type { NextApiResponse } from 'next';
import prisma from './prisma';
import { apiKeyNotConfigured, serverError } from './apiErrors';
import {
  getAIConfig,
  tokenFieldFor,
  normalizeTemperature,
  buildDeepSeekThinking,
  injectThinkingGuidance,
  stripThinkTags,
  type AIConfig,
} from './aiProvider';
import { buildSystemPrompt } from './systemPrompt';
import { truncateMessagesIfNeeded, injectTruncationNote, type MessageForTruncation } from './messageUtils';
import { persistApiRequest } from './apiLog';

export interface PromptMessage {
  role: string;
  content: string;
}

/**
 * Resolve the AI config, writing the appropriate error response and returning
 * null when it is unavailable.
 */
export async function resolveAIConfig(res: NextApiResponse): Promise<AIConfig | null> {
  const cfg = await getAIConfig();
  if ('error' in cfg) {
    if (cfg.code === 'NO_API_KEY') apiKeyNotConfigured(res);
    else serverError(res, cfg.error, cfg.code);
    return null;
  }
  return cfg;
}

/** True when DeepSeek reasoning mode is active and `<think>` filtering is required. */
export function isThinkingEnabled(cfg: AIConfig): boolean {
  return cfg.provider === 'deepseek' && cfg.deepseekThinking === 'enabled';
}

export interface UpstreamBodyOpts {
  messages: PromptMessage[];
  stream: boolean;
  /** Temperature before provider normalization. Defaults to the configured value. */
  temperature?: number;
  /** Max tokens to request. Defaults to the configured value. */
  maxTokens?: number;
}

/**
 * Assemble the upstream request body with consistent field ordering:
 * model, temperature, stream, max-tokens field, thinking, messages.
 */
export function buildUpstreamBody(cfg: AIConfig, opts: UpstreamBodyOpts): Record<string, unknown> {
  const tokenField = tokenFieldFor(cfg.provider, cfg.model, cfg.tokenFieldOverride);
  const temperature = opts.temperature ?? cfg.temperature;
  const normTemp = normalizeTemperature(cfg.provider, cfg.model, temperature, cfg.enableTemperature);
  const maxTokens = opts.maxTokens ?? cfg.maxTokens;
  return {
    model: cfg.model,
    ...(normTemp !== undefined ? { temperature: normTemp } : {}),
    stream: opts.stream,
    ...(maxTokens ? { [tokenField]: maxTokens } : {}),
    ...buildDeepSeekThinking(cfg),
    messages: opts.messages,
  };
}

/**
 * Prefix user messages with the persona name so the model can tell speakers
 * apart. Assistant messages pass through untouched.
 */
export function formatHistoryForPrompt(
  messages: Array<{ role: string; content: string }>,
  personaName: string,
): PromptMessage[] {
  const prefix = `${personaName}: `;
  return messages.map(m => (
    m.role === 'user' && !m.content.startsWith(prefix)
      ? { role: m.role, content: prefix + m.content }
      : { role: m.role, content: m.content }
  ));
}

export interface ConversationPromptOpts {
  cfg: AIConfig;
  persona: { name: string; profile?: string | null } & Record<string, any>;
  character: { name: string } & Record<string, any>;
  /** Raw DB history, oldest first. */
  history: Array<{ role: string; content: string }>;
  summary?: string | null;
  userPromptBody?: string | null;
}

export interface ConversationPrompt {
  /** System + history before truncation. */
  baseMessages: PromptMessage[];
  /** Messages actually sent upstream. */
  messages: PromptMessage[];
  wasTruncated: boolean;
  removedCount: number;
}

/**
 * Build the full message array for a conversation-style request:
 * system prompt + persona-prefixed history, truncated to the configured limit,
 * with the truncation note and DeepSeek thinking guidance applied.
 */
export function buildConversationPrompt(opts: ConversationPromptOpts): ConversationPrompt {
  const { cfg, persona, character, history, summary, userPromptBody } = opts;

  const systemContent = buildSystemPrompt(persona as any, character as any, {
    summary: summary || undefined,
    userPromptBody: userPromptBody || undefined,
  });

  const baseMessages: PromptMessage[] = [
    { role: 'system', content: systemContent },
    ...formatHistoryForPrompt(history, persona.name),
  ];

  const truncationResult = truncateMessagesIfNeeded(baseMessages as MessageForTruncation[], cfg.truncationLimit);
  injectTruncationNote(truncationResult);
  injectThinkingGuidance(cfg, truncationResult.messages, { personaName: persona.name, charName: character.name });

  return {
    baseMessages,
    messages: truncationResult.messages,
    wasTruncated: truncationResult.wasTruncated,
    removedCount: truncationResult.removedCount,
  };
}

/** Persist the outgoing request plus truncation metadata for the debug download. */
export async function persistRequestWithMeta(
  sessionId: number,
  body: Record<string, unknown>,
  prompt: ConversationPrompt,
  truncationLimit: number,
): Promise<void> {
  await persistApiRequest(sessionId, {
    ...body,
    __meta: {
      wasTruncated: !!prompt.wasTruncated,
      sentCount: prompt.messages.length,
      baseCount: prompt.baseMessages.length,
      truncationLimit,
    },
  });
}

/** Read a user prompt body by id, or fall back to the configured default prompt. */
export async function loadUserPromptBody(userPromptId?: number | null): Promise<string> {
  let id = userPromptId ?? null;
  if (!id) {
    const setting = await prisma.setting.findUnique({ where: { key: 'defaultPromptId' } });
    const parsed = setting?.value ? parseInt(setting.value, 10) : NaN;
    id = isNaN(parsed) ? null : parsed;
  }
  if (!id) return '';
  const prompt = await prisma.userPrompt.findUnique({ where: { id } });
  return prompt?.body || '';
}

/** Parse an upstream response body, tagging non-JSON payloads with `__rawText`. */
export function parseUpstreamBody(rawText: string): any {
  try {
    return JSON.parse(rawText);
  } catch {
    return { __rawText: rawText };
  }
}

/**
 * Forward an upstream (>=400) failure to the client in the shared error shape.
 * Always returns the response object so callers can `return` it directly.
 */
export function forwardUpstreamError(
  res: NextApiResponse,
  status: number,
  data: any,
  rawText: string,
  logLabel: string,
) {
  const errPayload = (data && !data.__rawText) ? data : { message: rawText };
  const errorMsg = errPayload?.error?.message || errPayload?.message || 'Upstream request failed';
  console.warn(`${logLabel} Upstream failed: ${status} ${errorMsg}`);
  return res.status(status).json({
    error: {
      message: errorMsg,
      upstreamStatus: status,
      type: errPayload?.type,
      code: errPayload?.code,
    },
    upstream: errPayload,
  });
}

/**
 * Pull the assistant text out of a non-streaming completion response,
 * stripping `<think>` blocks when reasoning mode is on.
 */
export function extractUpstreamContent(data: any, thinkingEnabled: boolean): string | undefined {
  const raw: unknown = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof raw !== 'string' || !raw) return undefined;
  return thinkingEnabled ? stripThinkTags(raw) : raw;
}
