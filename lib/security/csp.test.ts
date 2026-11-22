import { describe, expect, it } from "vitest";

import { buildCsp, generateNonce, sentryIngestOrigin, SONNER_STYLE_HASHES } from "./csp";

const base = {
  nonce: "abc123",
  supabaseUrl: "https://proj.supabase.co",
  sentryDsn: "https://key@o1.ingest.us.sentry.io/2",
};

function directive(csp: string, name: string): string[] {
  const entry = csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);
  return entry ? entry.split(" ").slice(1) : [];
}

describe("buildCsp (production)", () => {
  const csp = buildCsp({ ...base, isDev: false });

  it("uses a nonce and strict-dynamic for scripts, never unsafe-inline/eval", () => {
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("requires the nonce for <style> elements", () => {
    expect(directive(csp, "style-src")).toEqual(["'self'", "'nonce-abc123'", ...SONNER_STYLE_HASHES]);
  });

  it("blocks framing, plugins and base-tag hijacking", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows only the approved third parties", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toEqual(
      expect.arrayContaining([
        "https://proj.supabase.co",
        "wss://proj.supabase.co",
        "https://api.stripe.com",
        "https://o1.ingest.us.sentry.io",
      ]),
    );
    expect(directive(csp, "frame-src")).toEqual([
      "https://js.stripe.com",
      "https://*.js.stripe.com",
      "https://hooks.stripe.com",
      "https://challenges.cloudflare.com",
    ]);
    const allHosts = csp.match(/https:\/\/[^\s;]+/g) ?? [];
    const allowed = /(stripe\.com|supabase\.co|cloudflare\.com|sentry\.io|vercel-scripts\.com|vercel-insights\.com)$/;
    for (const host of allHosts) expect(host, host).toMatch(allowed);
  });
});

describe("buildCsp (development)", () => {
  const csp = buildCsp({ ...base, isDev: true, supabaseUrl: "http://127.0.0.1:54321" });

  it("adds unsafe-eval only in dev (React debugging) and skips the HTTPS upgrade", () => {
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(directive(csp, "connect-src")).toContain("ws://127.0.0.1:54321");
  });
});

describe("helpers", () => {
  it("generates unique base64 nonces of 128 bits", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });

  it("extracts only the Sentry ingest origin from a DSN", () => {
    expect(sentryIngestOrigin("https://pub@o9.ingest.de.sentry.io/1")).toBe("https://o9.ingest.de.sentry.io");
    expect(sentryIngestOrigin("garbage")).toBeNull();
    expect(sentryIngestOrigin(undefined)).toBeNull();
  });
});

describe("sonner style hash", () => {
  it("matches the stylesheet the installed sonner injects", async () => {
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const src = readFileSync("node_modules/sonner/dist/index.mjs", "utf8");
    const call = src.slice(src.indexOf('__insertCSS("') + "__insertCSS(".length);
    const css = JSON.parse(call.slice(0, call.indexOf('");') + 1)) as string;
    const hash = `'sha256-${createHash("sha256").update(css).digest("base64")}'`;
    expect(SONNER_STYLE_HASHES).toContain(hash);
  });
});
