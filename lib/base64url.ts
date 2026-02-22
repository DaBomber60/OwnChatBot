/**
 * Shared base64-url encoding/decoding helpers.
 *
 * Works in Edge middleware (atob/btoa) and Node 18+ API routes.
 * Single source of truth — imported by jwtCrypto.ts and importToken.ts.
 */

/** Decode a base64url string to Uint8Array. */
export function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a Uint8Array to a base64url string (no padding). */
export function toBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Encode a UTF-8 string to a base64url string. */
export function strToB64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Decode a base64url string to a UTF-8 string. */
export function b64urlToStr(b64url: string): string {
  const bytes = b64urlToUint8Array(b64url);
  return new TextDecoder().decode(bytes);
}
