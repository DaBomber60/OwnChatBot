import { PROVIDER_DISPLAY_NAMES } from './chatSettings';
import type { AIProvider } from '../../types/models';

/**
 * Every user-facing AI failure message lives here. Voice rules:
 * 1. `title` says what happened in plain language, with a little personality. Never blame the user.
 * 2. `body` gives the concrete next action, naming the exact setting or button.
 * 3. Personality must never obscure the fact. No emoji, no exclamation marks.
 * 4. Raw upstream text belongs in `detail`, never in `title`.
 */

export type ChatErrorCode =
  | 'THINKING_ONLY'
  | 'THINKING_TRUNCATED'
  | 'EMPTY_RESPONSE'
  | 'UPSTREAM_DOWN'
  | 'UPSTREAM_STALLED'
  | 'UPSTREAM_UNPARSEABLE'
  | 'STREAM_INTERRUPTED'
  | 'CONTEXT_TRUNCATED'
  | 'MAX_TOKENS'
  | 'UPSTREAM_ERROR';

export interface ChatErrorContext {
  provider?: AIProvider;
  /** Seconds we waited for the first token before giving up. */
  timeoutSeconds?: number;
  /** Seconds allowed between chunks once the reply had started. */
  stallSeconds?: number;
  maxTokens?: number;
  /** Messages that fit in the context window, out of `baseCount` total. */
  sentCount?: number;
  baseCount?: number;
  /** Raw upstream/technical text, rendered verbatim in a code block. */
  detail?: string;
}

export interface ChatErrorCopy {
  code: ChatErrorCode;
  title: string;
  body: string;
  detail?: string;
}

/** e.g. "the DeepSeek API"; falls back to "the API" when the provider is unknown. */
function apiLabel(provider?: AIProvider): string {
  const name = provider ? PROVIDER_DISPLAY_NAMES[provider] || provider : '';
  return name ? `the ${name} API` : 'the API';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Builds the title/body pair shown in the error modal for a given failure. */
export function describeChatError(code: ChatErrorCode, ctx: ChatErrorContext = {}): ChatErrorCopy {
  const api = apiLabel(ctx.provider);
  const detail = ctx.detail?.trim() || undefined;
  const copy = (title: string, body: string): ChatErrorCopy => ({ code, title, body, detail });

  switch (code) {
    case 'THINKING_ONLY':
      return copy(
        'The AI thought to itself for a while, then forgot to actually say anything.',
        'It sent us its reasoning but never got around to a reply. You\'re safe to retry sending the message — this usually sorts itself out.',
      );

    case 'THINKING_TRUNCATED':
      return copy(
        'The AI got so lost in thought it ran out of room to answer.',
        ctx.maxTokens
          ? `Its reasoning used the entire ${ctx.maxTokens} token budget before it started replying. Raise Max Tokens in Settings, or turn off Reasoning.`
          : 'Its reasoning used the entire token budget before it started replying. Raise Max Tokens in Settings, or turn off Reasoning.',
      );

    case 'EMPTY_RESPONSE':
      return copy(
        'The AI came back empty-handed — no reply, no reasoning, nothing.',
        `${cap(api)} accepted the request but sent nothing back. Please retry sending the message.`,
      );

    case 'UPSTREAM_DOWN':
      return copy(
        `OwnChatBot is fine — ${api} just isn't picking up.`,
        ctx.timeoutSeconds
          ? `Nothing arrived in ${ctx.timeoutSeconds} seconds, so we stopped waiting. You can raise the timeout in Settings.`
          : 'Nothing arrived before we stopped waiting. You can raise the timeout in Settings.',
      );

    case 'UPSTREAM_STALLED':
      return copy(
        `${cap(api)} started replying, then went quiet mid-sentence.`,
        ctx.stallSeconds
          ? `Nothing new arrived for ${ctx.stallSeconds} seconds, so the request was cancelled. What did arrive has been kept — press Continue to resume, or raise the timeout in Settings and retry the message.`
          : 'The request was cancelled after a long silence. What did arrive has been kept — press Continue to resume, or raise the timeout in Settings and retry the message.',
      );

    case 'UPSTREAM_UNPARSEABLE':
      return copy(
        `${cap(api)} replied, but we couldn't make sense of it.`,
        "The response wasn't valid JSON. Press Retry; if it keeps happening, check the Base URL in Settings.",
      );

    case 'STREAM_INTERRUPTED':
      return copy(
        `The connection to ${api} dropped mid-reply.`,
        'Anything that arrived before the drop has been saved. Press Continue to pick up from there.',
      );

    case 'CONTEXT_TRUNCATED':
      return copy(
        ctx.sentCount && ctx.baseCount
          ? `Only the last ${ctx.sentCount} of ${ctx.baseCount} messages fit in the context window.`
          : 'Some older messages did not fit in the context window.',
        'Older history was trimmed from this request, so the AI may have lost the thread. Increase Max Characters in Settings to include more.',
      );

    case 'MAX_TOKENS':
      return copy(
        'The reply hit the Max Tokens ceiling and stopped mid-thought.',
        ctx.maxTokens
          ? `It reached the ${ctx.maxTokens} token limit. Press Continue to pick up where it left off, or raise Max Tokens in Settings and retry.`
          : 'Press Continue to pick up where it left off, or raise Max Tokens in Settings and retry.',
      );

    case 'UPSTREAM_ERROR':
    default:
      return copy(
        `${cap(api)} turned down the request.`,
        'Press Retry to try again. If it keeps happening, check your API key and Base URL in Settings.',
      );
  }
}

/** Maps an API error `code` onto chat copy. Non-streaming callers have no `thinking` frames to go on. */
export function describeServerError(code: unknown, ctx: ChatErrorContext = {}): ChatErrorCopy {
  // Mapped codes get purpose-written copy, so the raw server text would only be noise.
  const mapped = { ...ctx, detail: undefined };
  switch (code) {
    case 'UPSTREAM_THINKING_ONLY':
      return describeChatError('THINKING_ONLY', mapped);
    case 'UPSTREAM_NO_CONTENT':
      return describeChatError('EMPTY_RESPONSE', mapped);
    case 'UPSTREAM_TIMEOUT':
      return describeChatError('UPSTREAM_DOWN', mapped);
    default:
      return describeChatError('UPSTREAM_ERROR', ctx);
  }
}
