// Sentry initialization for the edge runtime (required even when running locally).
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NEXT_PUBLIC_APP_ENV));
