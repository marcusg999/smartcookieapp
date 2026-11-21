/**
 * Static security headers applied to every route via next.config.ts
 * (CLAUDE.md §5.9). The per-request CSP is set in proxy.ts.
 */
export const securityHeaders: Array<{ key: string; value: string }> = [
  // Two years, all subdomains. Submit to the HSTS preload list only once the
  // production domain is final and every subdomain serves HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Camera, microphone and geolocation off. Payment stays available to
    // Stripe so Apple Pay / Google Pay / Link work inside its iframe.
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "browsing-topics=()",
      "usb=()",
      'payment=(self "https://js.stripe.com")',
    ].join(", "),
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];
