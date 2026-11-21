import "server-only";

/**
 * Have I Been Pwned "range" check (k-anonymity): only the first 5 characters
 * of the password's SHA-1 hash leave the server. Returns true if the password
 * appears in known breaches.
 *
 * Fails open (returns false) if the API can't be reached, so an outage never
 * blocks sign-up; Supabase's built-in leaked-password protection (enable it
 * on hosted projects) is the second line of defence.
 */
export async function isPwnedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
