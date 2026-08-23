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
/** The edit textarea never shrinks below this even on very short viewports. */
export const EDIT_INPUT_MAX_FLOOR = 400;
export const EDIT_INPUT_VIEWPORT_RATIO = 0.65;

/** Gap between the chat header and the message container (the header's mb-8). */
export const HEADER_GAP_PX = 32;
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

/** Resolves the edit textarea's max height against the current viewport. */
export function editTextareaMaxHeight(): number {
  const viewportMax = typeof window !== 'undefined'
    ? Math.floor(window.innerHeight * EDIT_INPUT_VIEWPORT_RATIO)
    : EDIT_INPUT_MAX_HEIGHT;
  return Math.max(EDIT_INPUT_MAX_FLOOR, Math.min(EDIT_INPUT_MAX_HEIGHT, viewportMax));
}
