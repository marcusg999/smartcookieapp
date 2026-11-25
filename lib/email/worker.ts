import "server-only";

import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";

import { EMAIL_CATALOG } from "./catalog";
import { sendEmail } from "./send";
import { buildVariables, SkipEmail, type QueuedEmail } from "./vars";

type Admin = ReturnType<typeof createAdminClient>;

export const MAX_ATTEMPTS = 5;
/** Retry delays after attempts 1..4 (minutes): 1, 5, 30, 120. */
const BACKOFF_MIN = [1, 5, 30, 120];

/**
 * Drain the email queue (Phase 9). Each row is claimed with a conditional
 * update, so overlapping runs never send the same email twice; the row id
 * is the provider idempotency key, so a crash between "sent" and "marked
 * sent" can't double-send either. Marketing email respects the recipient's
 * preferences. Once handled, the readable address is cleared (only the
 * recipient hash stays in the log) and one-time link tokens are scrubbed.
 */
export async function processEmailQueue(admin: Admin, limit = 50) {
  const now = new Date().toISOString();
  const { data: due } = await admin
    .from("notifications_log")
    .select("id, template_key, to_address, payload, household_id, organization_id, user_id, attempts")
    .eq("status", "queued")
    .lte("next_attempt_at", now)
    .order("next_attempt_at")
    .limit(limit);
  if (!due?.length) return { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const [{ data: settings }, { data: copyRows }] = await Promise.all([
    admin.from("site_settings").select("timezone").eq("id", true).single(),
    admin.from("content_blocks").select("key, published_value").like("key", "email.%"),
  ]);
  const timezone = (settings?.timezone as string | undefined) ?? "America/Los_Angeles";
  const copy: Record<string, string> = {};
  for (const r of copyRows ?? []) if (typeof r.published_value === "string") copy[r.key as string] = r.published_value;

  const tally = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  // A few at a time: rendering is CPU work and sends wait on the network.
  // Each row is still claimed on its own first, so nothing is sent twice.
  const CONCURRENCY = 4;
  let next = 0;
  const lane = async () => {
    while (next < due.length) {
      const row = due[next++]!;
      const { data: claimed } = await admin
        .from("notifications_log")
        .update({ status: "sending" })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      tally.processed++;
      const outcome = await handleOne(admin, row as QueuedEmail & { attempts: number }, copy, timezone);
      tally[outcome]++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, lane));
  return tally;
}

async function finish(
  admin: Admin,
  id: string,
  patch: Record<string, unknown>,
  payload: Record<string, unknown> | null,
) {
  // The one-time "repeat last week" token must not sit readable in the log.
  const scrubbed = payload && "deep_link_token" in payload ? { ...payload, deep_link_token: "[used]" } : payload;
  await admin
    .from("notifications_log")
    .update({ ...patch, to_address: null, payload: scrubbed })
    .eq("id", id);
}

async function handleOne(
  admin: Admin,
  n: QueuedEmail & { attempts: number },
  copy: Record<string, string>,
  timezone: string,
): Promise<"sent" | "skipped" | "failed"> {
  const entry = EMAIL_CATALOG[n.template_key];
  if (!n.to_address) {
    await finish(admin, n.id, { status: "skipped", error: "no recipient" }, n.payload);
    return "skipped";
  }
  try {
    let unsubscribe: { pageUrl: string; oneClickUrl: string; label: string } | null = null;
    if (entry?.category === "marketing" && entry.topic) {
      const userId = n.user_id ?? (await householdUser(admin, n.household_id));
      if (!userId) throw new SkipEmail("no account for marketing email");
      const { data: prefs } = await admin
        .from("email_preferences")
        .select("menu_published, cutoff_reminders")
        .eq("user_id", userId)
        .maybeSingle();
      if (prefs && prefs[entry.topic] === false) throw new SkipEmail(`opted out of ${entry.topic}`);
      const { data: token } = await admin.rpc("_ensure_email_preferences", { p_user: userId });
      const q = `token=${encodeURIComponent(String(token))}&topic=${entry.topic}`;
      unsubscribe = {
        pageUrl: new URL(`/unsubscribe?${q}`, env.NEXT_PUBLIC_SITE_URL).toString(),
        oneClickUrl: new URL(`/api/unsubscribe?${q}`, env.NEXT_PUBLIC_SITE_URL).toString(),
        label: copy["email.footer.unsubscribe"] || "Unsubscribe",
      };
    }
    const variables = await buildVariables(admin, n, copy, timezone);
    const reasonKey =
      entry?.category === "marketing"
        ? `email.footer.${entry.topic}`
        : entry?.category === "security"
          ? "email.footer.security"
          : "email.footer.transactional";
    const res = await sendEmail(admin, {
      templateKey: n.template_key,
      to: n.to_address,
      variables,
      idempotencyKey: `notification/${n.id}`,
      unsubscribe,
      footerReason: copy[reasonKey] ?? "",
    });
    if (res.ok) {
      await finish(
        admin,
        n.id,
        { status: "sent", provider_id: res.providerId, sent_at: new Date().toISOString(), error: null },
        n.payload,
      );
      return "sent";
    }
    return await retryOrFail(admin, n, res.error, res.retry);
  } catch (error) {
    if (error instanceof SkipEmail) {
      await finish(admin, n.id, { status: "skipped", error: error.message }, n.payload);
      return "skipped";
    }
    return await retryOrFail(admin, n, (error as Error).message ?? "error", true);
  }
}

async function retryOrFail(
  admin: Admin,
  n: { id: string; attempts: number; payload: Record<string, unknown> | null },
  error: string,
  retry: boolean,
) {
  const attempts = n.attempts + 1;
  if (retry && attempts < MAX_ATTEMPTS) {
    const next = new Date(Date.now() + BACKOFF_MIN[attempts - 1]! * 60_000).toISOString();
    await admin
      .from("notifications_log")
      .update({ status: "queued", attempts, next_attempt_at: next, error: error.slice(0, 300) })
      .eq("id", n.id);
    return "failed" as const;
  }
  await finish(admin, n.id, { status: "failed", attempts, error: error.slice(0, 300) }, n.payload);
  return "failed" as const;
}

async function householdUser(admin: Admin, householdId: string | null) {
  if (!householdId) return null;
  const { data } = await admin.from("households").select("primary_user_id").eq("id", householdId).maybeSingle();
  return (data?.primary_user_id as string | null) ?? null;
}
