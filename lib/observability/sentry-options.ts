import type * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * Shared Sentry options for client, server and edge. PII is never sent:
 * the SDK's `dataCollection` options (v11 replacement for `sendDefaultPii`) drop user info,
 * bodies and identifying headers, and every event and breadcrumb is passed
 * through `scrubEvent` / `scrubBreadcrumb` / `scrubSpan` as a final filter.
 */
export function sentryOptions(dsn: string | undefined, environment: string | undefined): SentryInitOptions {
  return {
    dsn,
    environment,
    // Off in tests and with the placeholder DSN from .env.example.
    enabled: Boolean(dsn) && !dsn?.includes("examplePublicKey@") && process.env.NODE_ENV !== "test",
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    dataCollection: {
      userInfo: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      httpBodies: [],
      httpHeaders: { deny: ["forwarded", "-ip", "remote-", "via", "-user", "cookie", "authorization"] },
      cookies: { deny: ["sb-", "auth", "session"] },
      urlQueryParams: { deny: ["email", "token", "code", "forwarded", "-ip", "remote-", "via", "-user"] },
    },
    beforeSend: scrubEvent,
    // Spans are streamed in v11, so span attributes are scrubbed here.
    beforeSendSpan: scrubSpan,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
