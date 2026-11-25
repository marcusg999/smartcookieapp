import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 10 security review (AuthZ sweep): every exported Server Action must
 * start by authenticating/authorizing through one of the project's guards.
 * A new action that forgets this fails CI. Public actions (sign-in, sign-up,
 * unsubscribe, email links) are listed explicitly with how they're protected.
 */
const GUARDS = [
  "adminAction(", // staff role + AAL2 + Zod + audit (lib/admin/action.ts)
  "familyAction(", // signed-in parent + household + Zod + rate limit
  "schoolAction(", // school admin/staff of an approved org + Zod
  "authorizeStaffChange(", // owner + AAL2 + fresh step-up
  "requireStaffAAL2(",
  "requireUser(",
  "getUser(", // followed by an explicit "not signed in" return
  "preflight(", // Turnstile + per-IP rate limit for auth forms
];

/** Public on purpose: reachable signed out, protected another way. */
const PUBLIC: Record<string, string> = {
  "app/(auth)/actions.ts:signInWithPassword": "Turnstile + per-IP rate limit (preflight) + lockout",
  "app/(auth)/actions.ts:signUp": "Turnstile + per-IP rate limit",
  "app/(auth)/actions.ts:requestMagicLink": "Turnstile + per-IP and per-email rate limits",
  "app/(auth)/actions.ts:requestPasswordReset": "Turnstile + per-IP and per-email rate limits",
  "app/(auth)/actions.ts:signInWithOAuth": "per-IP rate limit; Supabase PKCE",
  "app/(marketing)/unsubscribe/actions.ts:confirmUnsubscribe":
    "random token is the key; rate limited; only flips opt-outs",
  "app/r/[token]/actions.ts:redeemRepeatLink": "single-use hashed token; rate limited; never signs in staff",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** The body of each exported async function (brace-matched; Prettier puts the body's "{" at line end). */
function exportedActions(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
    // The body's "{" ends a line and isn't a type literal opening a generic ("<{").
    const re = /(?<![<(,:|&] ?)\{\n/g;
    re.lastIndex = m.index!;
    const start = re.exec(src)!.index;
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push({ name: m[1]!, body: src.slice(start, i + 1) });
  }
  return out;
}

const files = ["app", "lib", "components"]
  .flatMap((d) => walk(d))
  .filter((f) => /^\s*["']use server["'];?/.test(readFileSync(f, "utf8")));

describe("server actions are guarded", () => {
  it("finds the server action files", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const { name, body } of exportedActions(src)) {
      const key = `${file}:${name}`;
      it(key, () => {
        if (PUBLIC[key]) {
          // Public actions still validate input and rate-limit.
          expect(body, `${key} should validate input`).toMatch(/safeParse\(|preflight\(/);
          expect(body, `${key} should be rate limited`).toMatch(/rateLimit\(|preflight\(/);
          return;
        }
        const guard = GUARDS.find((g) => body.includes(g));
        expect(guard, `${key} doesn't call a guard (${GUARDS.join(" ")})`).toBeDefined();
      });
    }
  }

  it("the public allow-list has no stale entries", () => {
    const all = new Set(files.flatMap((f) => exportedActions(readFileSync(f, "utf8")).map((a) => `${f}:${a.name}`)));
    for (const key of Object.keys(PUBLIC)) expect(all.has(key), key).toBe(true);
  });
});
