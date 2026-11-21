/**
 * Cloudflare's documented Turnstile test keys. With these, no widget loads
 * and no network call is made; a fixed dummy token is used instead. The env
 * schema rejects them in production.
 */
export const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA", // always passes
  "2x00000000000000000000AB", // always blocks
  "3x00000000000000000000FF", // forces an interactive challenge
]);
export const TURNSTILE_TEST_SECRET_KEYS = new Set([
  "1x0000000000000000000000000000000AA", // always passes
  "2x0000000000000000000000000000000AA", // always fails
]);
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export function isTurnstileTestSiteKey(key: string | undefined): boolean {
  return Boolean(key && TURNSTILE_TEST_SITE_KEYS.has(key));
}
