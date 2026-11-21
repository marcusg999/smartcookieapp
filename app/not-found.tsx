import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">We couldn&apos;t find that page.</p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
