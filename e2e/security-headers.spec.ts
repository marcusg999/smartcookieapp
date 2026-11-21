import { expect, test } from "@playwright/test";

/**
 * Mirrors the checks securityheaders.com grades (CSP, HSTS, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Permissions-Policy), plus the
 * stricter rules from CLAUDE.md §5.9. All present and strict = "A" grade.
 */
const pages = ["/", "/menu", "/sign-in", "/account", "/admin"];

for (const path of pages) {
  test(`security headers on ${path}`, async ({ request }) => {
    const res = await request.get(path);
    const h = res.headers();

    expect(h["strict-transport-security"]).toMatch(/max-age=(\d+)/);
    expect(Number(h["strict-transport-security"].match(/max-age=(\d+)/)?.[1])).toBeGreaterThanOrEqual(31536000);
    expect(h["strict-transport-security"]).toContain("includeSubDomains");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
    expect(h["permissions-policy"]).toMatch(/microphone=\(\)/);
    expect(h["permissions-policy"]).toMatch(/geolocation=\(\)/);
    expect(h["x-powered-by"]).toBeUndefined();

    const csp = h["content-security-policy"];
    expect(csp).toBeTruthy();
    const script = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
}

test("every response gets a fresh nonce, applied to all scripts", async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const res = await request.get("/");
    const nonce = res.headers()["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    nonces.add(nonce!);

    const html = await res.text();
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) expect(tag, tag).toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(3);
});

test("static headers also apply to API routes", async ({ request }) => {
  const res = await request.post("/api/webhooks/stripe", { data: {} });
  expect(res.headers()["strict-transport-security"]).toBeTruthy();
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
