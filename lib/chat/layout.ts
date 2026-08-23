/**
 * Layout measurements shared between the chat page's JS sizing logic and CSS.
 * The height values below are mirrored as custom properties in styles/globals.css
 * (--chat-input-*, --message-edit-*); change both together.
 */

/** Composer textarea auto-resize bounds. Mirrors .chat-input min-height/max-height. */
export const CHAT_INPUT_MIN_HEIGHT = 80;
export const CHAT_INPUT_MAX_HEIGHT = 240;

/** Message edit textarea bounds. Mirrors .message-edit-input min-height/max-height. */
export const EDIT_INPUT_MIN_HEIGHT = 100;
export const EDIT_INPUT_MAX_HEIGHT = 500;
/** Breathing room kept between the edit box and the edges of the visible area. */
export const EDIT_VIEWPORT_MARGIN = 12;

/** Gap between the chat header and the message container (the header's mb-8). */
export const HEADER_GAP_PX = 32;
/** Narrow screens can't spare 32px of empty gutter. */
export const HEADER_GAP_COMPACT_PX = 8;
/** Pre-measurement estimate: 80px header + HEADER_GAP_PX. */
export const INITIAL_HEADER_HEIGHT = 112;

/** Distance from the bottom within which the view counts as pinned to the latest message. */
export const BOTTOM_PIN_THRESHOLD_PX = 120;
/** Distance from the top that triggers loading the previous page of messages. */
export const TOP_LOAD_THRESHOLD_PX = 120;

/** Hold duration on the variant button before the temperature popover opens. */
export const VARIANT_LONG_PRESS_MS = 450;

/** Typewriter reveal: slowest the text is ever revealed. */
export const REVEAL_MIN_CHARS_PER_SEC = 120;
/** Any backlog is drained within this window, so the display never lags further behind. */
export const REVEAL_CATCHUP_MS = 250;

/** Duration of the eased scroll-to-bottom used for non-streamed replies. */
export const SMOOTH_SCROLL_MS = 280;

/**
 * Clamps the edit textarea to the space actually available to it. `availableHeight` is the
 * visible height left once the surrounding bubble chrome and the on-screen keyboard are
 * accounted for, so the whole edit area stays reachable on mobile.
 */
export function editTextareaMaxHeight(availableHeight: number): number {
  if (!Number.isFinite(availableHeight)) return EDIT_INPUT_MAX_HEIGHT;
  return Math.max(EDIT_INPUT_MIN_HEIGHT, Math.min(EDIT_INPUT_MAX_HEIGHT, Math.floor(availableHeight)));
}
