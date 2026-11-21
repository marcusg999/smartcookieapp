/**
 * PII scrubbing for Sentry events (CLAUDE.md §3 Observability, §5.11).
 *
 * Child data (names, allergies, dietary needs) is sensitive. Anything that
 * looks like personal data is replaced with "[Filtered]" before an event or
 * breadcrumb leaves the process:
 *  - keys naming personal fields (email, name, phone, address, notes, …),
 *  - whole subtrees under `children`, `child`, `allergies`, `allergens`,
 *    `dietary*` keys,
 *  - credentials (password, token, secret, authorization, cookie, …),
 *  - email addresses embedded in any string (messages, URLs, exceptions).
 */

export const FILTERED = "[Filtered]";

const SENSITIVE_KEY =
  /(^|_|-|\.)(e-?mail|name|first_?name|last_?name|full_?name|surname|phone|address|street|postcode|zip|notes?|dob|birth|ip_?address)($|_|-|\.)/i;
const SENSITIVE_SUBTREE = /^(children|child|kids?|allerg(y|ies|ens?)|dietary.*|diet)$/i;
const CREDENTIAL_KEY = /(password|passwd|secret|token|api_?key|authorization|cookie|session|set-cookie)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Keys inside Sentry's own structural objects that are safe and must be kept. */
const STRUCTURAL_CONTEXTS = new Set([
  "os",
  "browser",
  "device",
  "runtime",
  "trace",
  "otel",
  "app",
  "culture",
  "cloud_resource",
  "react",
  "nextjs",
]);

export function scrubString(value: string): string {
  return value.replace(EMAIL, FILTERED);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || CREDENTIAL_KEY.test(key) || SENSITIVE_SUBTREE.test(key);
}

/** Deep-scrub any JSON-like value. Cycles are cut off. */
export function scrubValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => scrubValue(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? FILTERED : scrubValue(inner, seen);
  }
  return out;
}

type Breadcrumb = { message?: string; data?: Record<string, unknown> };

type ScrubbableEvent = {
  message?: string;
  user?: Record<string, unknown>;
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  logentry?: { message?: string; params?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
};

export function scrubBreadcrumb<T extends object>(crumb: T): T {
  const out: Breadcrumb = { ...(crumb as Breadcrumb) };
  if (typeof out.message === "string") out.message = scrubString(out.message);
  if (out.data) out.data = scrubValue(out.data) as Record<string, unknown>;
  return out as T;
}

/** Scrub a Sentry event in place-safe fashion and return it. */
export function scrubEvent<T extends object>(event: T): T {
  const out: ScrubbableEvent = { ...(event as ScrubbableEvent) };

  if (typeof out.message === "string") out.message = scrubString(out.message);

  // Keep only an opaque user id; drop email, username, IP address.
  if (out.user) out.user = typeof out.user.id === "string" ? { id: out.user.id } : undefined;

  if (out.request) {
    const request = { ...out.request };
    delete request.cookies;
    if (request.data !== undefined) request.data = scrubValue(request.data);
    if (typeof request.url === "string") request.url = scrubString(request.url);
    if (request.query_string !== undefined) request.query_string = scrubValue(request.query_string);
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([key]) => !CREDENTIAL_KEY.test(key) && !/forwarded|real-ip|-ip$/i.test(key),
        ),
      );
    }
    out.request = request;
  }

  if (out.extra) out.extra = scrubValue(out.extra) as Record<string, unknown>;
  if (out.tags) out.tags = scrubValue(out.tags) as Record<string, unknown>;

  if (out.contexts) {
    out.contexts = Object.fromEntries(
      Object.entries(out.contexts).map(([key, ctx]) => [key, STRUCTURAL_CONTEXTS.has(key) ? ctx : scrubValue(ctx)]),
    );
  }

  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((ex) => ({
        ...ex,
        value: typeof ex.value === "string" ? scrubString(ex.value) : ex.value,
      })),
    };
  }

  if (out.logentry) {
    out.logentry = {
      ...out.logentry,
      message: typeof out.logentry.message === "string" ? scrubString(out.logentry.message) : out.logentry.message,
      params: Array.isArray(out.logentry.params) ? (scrubValue(out.logentry.params) as unknown[]) : undefined,
    };
  }

  return out as T;
}

/** Scrub a streamed span's attributes (Sentry v11 `beforeSendSpan`). */
export function scrubSpan<T extends object>(span: T): T {
  const out = { ...(span as { description?: string; data?: Record<string, unknown> }) };
  if (typeof out.description === "string") out.description = scrubString(out.description);
  if (out.data) out.data = scrubValue(out.data) as Record<string, unknown>;
  return out as T;
}
