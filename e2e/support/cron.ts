/** The bearer secret for /api/cron/* in tests (playwright.config sets it on the test server). */
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-in-production-000";

/** Run the email worker once (what Vercel Cron does every minute). */
export async function drainEmailQueue(): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const res = await fetch(
    new URL("/api/cron/notifications", process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"),
    {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    },
  );
  if (!res.ok) throw new Error(`email worker answered ${res.status}`);
  return res.json();
}

/**
 * Run the worker until the queue is empty (e2e has no cron, so earlier tests
 * leave a backlog and a test's own email is the newest in the queue).
 */
export async function drainEmailQueueFully(maxRounds = 30) {
  for (let i = 0; i < maxRounds; i++) {
    const { processed } = await drainEmailQueue();
    if (processed === 0) return;
  }
}
