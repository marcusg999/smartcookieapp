"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

import { isTurnstileTestSiteKey, TURNSTILE_DUMMY_TOKEN } from "@/lib/auth/turnstile-keys";
import { publicEnv } from "@/lib/env.public";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile (CLAUDE.md §5.7). Renders a hidden
 * `cf-turnstile-response` field the server verifies. With Cloudflare's test
 * site key (local/CI) no script loads and a dummy token is used.
 */
export function Turnstile({ action }: { action: string }) {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const testMode = isTurnstileTestSiteKey(siteKey);
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState(testMode ? TURNSTILE_DUMMY_TOKEN : "");
  const [ready, setReady] = useState(false);
  const id = useId();

  useEffect(() => {
    if (testMode || !ready || !container.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      appearance: "interaction-only",
      callback: (t: string) => setToken(t),
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [ready, siteKey, action, testMode]);

  return (
    <>
      {!testMode && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setReady(true)}
        />
      )}
      <div ref={container} id={id} />
      <input type="hidden" name="cf-turnstile-response" value={token} />
    </>
  );
}
