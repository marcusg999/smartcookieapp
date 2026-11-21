/**
 * Content Security Policy builder (CLAUDE.md §5.9).
 *
 * Nonce-based: every request gets a fresh nonce from proxy.ts, and Next.js
 * attaches it to its own scripts automatically. `'strict-dynamic'` lets those
 * trusted scripts load their chunks; host allow-lists are a fallback for
 * older browsers. Only Stripe, Supabase, Cloudflare Turnstile, Sentry and
 * Vercel Analytics are allowed as third parties.
 */

export type CspOptions = {
  nonce: string;
  isDev: boolean;
  supabaseUrl: string;
  sentryDsn?: string;
};

const STRIPE = {
  script: ["https://js.stripe.com"],
  frame: ["https://js.stripe.com", "https://hooks.stripe.com"],
  connect: ["https://api.stripe.com"],
  img: ["https://*.stripe.com"],
  // Server actions redirect to hosted Checkout / Customer Portal. Chrome
  // enforces form-action on redirects that follow a form submission.
  formAction: ["https://checkout.stripe.com", "https://billing.stripe.com"],
};

const TURNSTILE = {
  script: ["https://challenges.cloudflare.com"],
  frame: ["https://challenges.cloudflare.com"],
};

const VERCEL_ANALYTICS = {
  script: ["https://va.vercel-scripts.com"],
  connect: ["https://vitals.vercel-insights.com"],
};

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Sentry DSNs look like https://<key>@o123.ingest.us.sentry.io/456; allow only that ingest host. */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Supabase Realtime uses WebSockets on the same host. */
function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, "ws");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp({ nonce, isDev, supabaseUrl, sentryDsn }: CspOptions): string {
  const supabase = origin(supabaseUrl);
  const sentry = sentryIngestOrigin(sentryDsn);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...STRIPE.script,
      ...TURNSTILE.script,
      ...VERCEL_ANALYTICS.script,
      // React uses eval() in development only, for error-stack reconstruction.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // <style> elements need the nonce. In dev, Next's HMR injects styles without one.
    "style-src": ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    // style="" attributes (used by some UI primitives) are allowed separately;
    // they can't execute script.
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", ...(supabase ? [supabase] : []), ...STRIPE.img],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase, toWebSocketOrigin(supabase)] : []),
      ...STRIPE.connect,
      ...(sentry ? [sentry] : []),
      ...VERCEL_ANALYTICS.connect,
    ],
    "frame-src": [...STRIPE.frame, ...TURNSTILE.frame],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...STRIPE.formAction],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
