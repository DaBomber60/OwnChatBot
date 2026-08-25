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
  | 'MAX_TOKENS'
  | 'BAD_API_KEY'
  | 'OUT_OF_CREDIT'
  | 'RATE_LIMITED'
  | 'CONTEXT_TOO_LONG'
  | 'PROVIDER_UNAVAILABLE'
  | 'UPSTREAM_ERROR';

export interface ChatErrorContext {
  provider?: AIProvider;
  /** Seconds we waited for the first token before giving up. */
  timeoutSeconds?: number;
  /** Seconds allowed between chunks once the reply had started. */
  stallSeconds?: number;
  /** Seconds the provider asked us to wait before trying again. */
  retryAfterSeconds?: number;
  maxTokens?: number;
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
  const name = providerName(provider);
  return name ? `the ${name} API` : 'the API';
}

function providerName(provider?: AIProvider): string {
  return provider ? PROVIDER_DISPLAY_NAMES[provider] || provider : '';
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
        "It sent us its reasoning but never got around to a reply. You're safe to retry sending the message — this usually sorts itself out.",
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
          ? `Nothing new arrived for ${ctx.stallSeconds} seconds, so the request was cancelled and the half-written reply was thrown away. Retry sending the message, or raise the timeout in Settings.`
          : 'The request was cancelled after a long silence, and the half-written reply was thrown away. Retry sending the message, or raise the timeout in Settings.',
      );

    case 'UPSTREAM_UNPARSEABLE':
      return copy(
        `${cap(api)} replied, but we couldn't make sense of it.`,
        "The response wasn't valid JSON. Press Retry; if it keeps happening, check the Base URL in Settings.",
      );

    case 'STREAM_INTERRUPTED':
      return copy(
        `The connection to ${api} dropped mid-reply.`,
        'We threw away the half-written reply rather than leave a fragment in your chat. Retry sending the message.',
      );

    case 'MAX_TOKENS':
      return copy(
        'The reply hit the Max Tokens ceiling and stopped mid-sentence.',
        ctx.maxTokens
          ? `It ran out at the ${ctx.maxTokens} token limit, so the half-finished reply was thrown away. Raise Max Tokens in Settings, then retry sending the message.`
          : 'It ran out of tokens, so the half-finished reply was thrown away. Raise Max Tokens in Settings, then retry sending the message.',
      );

    case 'BAD_API_KEY':
      return copy(
        `${cap(api)} does not recognise your API key.`,
        'Check the API key in Settings — it may be mistyped, revoked, or from a different provider.',
      );

    case 'OUT_OF_CREDIT':
      return copy(
        'The AI is willing, but the wallet is empty.',
        `Your ${providerName(ctx.provider)} account is out of credit. Top it up, then retry sending the message.`,
      );

    case 'RATE_LIMITED':
      return copy(
        `${cap(api)} is asking us to slow down.`,
        ctx.retryAfterSeconds
          ? `You have hit their rate limit. Wait about ${ctx.retryAfterSeconds} seconds, then retry sending the message.`
          : 'You have hit their rate limit. Wait a moment, then retry sending the message.',
      );

    case 'CONTEXT_TOO_LONG':
      return copy(
        'This conversation is now too long for the model to read.',
        'Lower Max Characters in Settings so older messages get trimmed, and write a summary to condense the history.',
      );

    case 'PROVIDER_UNAVAILABLE':
      return copy(
        `${cap(api)} is having problems on their end.`,
        'Nothing is wrong with us. Wait a little, then retry sending the message.',
      );

    case 'UPSTREAM_ERROR':
    default:
      // Catch-all: also covers network faults and our own 500s, so don't imply a rejection.
      return copy(
        `Something went wrong talking to ${api}.`,
        `${cap(api)} is likely down, or they just don't want to talk to us right now. Retry sending the message. If it keeps happening, check your API key and Base URL in Settings.`,
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
    case 'UPSTREAM_ABORTED':
      return describeChatError('UPSTREAM_DOWN', mapped);
    case 'UPSTREAM_MAX_TOKENS':
      return describeChatError('MAX_TOKENS', mapped);
    case 'UPSTREAM_AUTH':
    case 'API_KEY_NOT_CONFIGURED':
      return describeChatError('BAD_API_KEY', mapped);
    case 'UPSTREAM_QUOTA':
      return describeChatError('OUT_OF_CREDIT', mapped);
    case 'UPSTREAM_RATE_LIMITED':
    case 'RATE_LIMITED':
      return describeChatError('RATE_LIMITED', mapped);
    case 'UPSTREAM_CONTEXT_TOO_LONG':
      return describeChatError('CONTEXT_TOO_LONG', mapped);
    case 'UPSTREAM_UNAVAILABLE':
      return describeChatError('PROVIDER_UNAVAILABLE', mapped);
    case 'UPSTREAM_UNPARSEABLE':
      return describeChatError('UPSTREAM_UNPARSEABLE', mapped);
    default:
      return describeChatError('UPSTREAM_ERROR', ctx);
  }
}
