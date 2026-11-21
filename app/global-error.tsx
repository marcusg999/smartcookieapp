"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <main>
          <h1>Something went wrong</h1>
          <p>We&apos;ve been notified. Please refresh the page or try again in a moment.</p>
        </main>
      </body>
    </html>
  );
}
