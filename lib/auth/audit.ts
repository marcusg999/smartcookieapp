import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { requestMeta } from "./request-meta";

type AuditInput = {
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  /** Use when there is no signed-in user (failed sign-in, sign-up request). */
  anonymous?: boolean;
};

/**
 * Append an entry to the audit log (CLAUDE.md §5.6). The actor is whoever the
 * database sees as auth.uid(), so it can't be spoofed by the caller. Never
 * put raw emails or passwords in metadata; use `emailHash`.
 * Audit failures are swallowed (and reported to Sentry by the caller's error
 * handling) so they never break the user's flow.
 */
export async function audit(action: string, input: AuditInput = {}): Promise<void> {
  const { ip, userAgent } = await requestMeta();
  // Service role only for events with no user session (e.g. failed sign-in):
  // there's no auth.uid() to attribute them to, and RLS has no anon insert path.
  const client = input.anonymous ? createAdminClient() : await createClient();
  const { error } = await client.rpc("log_audit_event", {
    p_action: action,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_before: input.before ?? null,
    p_after: input.after ?? null,
    p_metadata: input.metadata ?? {},
    p_ip: ip === "unknown" ? null : ip,
    p_user_agent: userAgent,
  });
  if (error) console.error("audit log write failed", { action, code: error.code });
}
