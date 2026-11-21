const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type Summary = { ID: string; To: { Address: string }[]; Subject: string; Created: string };

/** Wait for the newest email to `to` and return the first link to our site. */
export async function waitForEmailLink(
  to: string,
  { timeoutMs = 20_000, subject }: { timeoutMs?: number; subject?: RegExp } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: Summary[] };
      const match = messages.find((m) => !subject || subject.test(m.Subject));
      if (match) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as {
          HTML: string;
          Text: string;
        };
        const href = (full.HTML || full.Text).match(/href="([^"]+\/auth\/confirm[^"]+)"/)?.[1];
        if (href) return href.replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to} within ${timeoutMs} ms`);
}
