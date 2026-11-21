import Link from "next/link";

import { Button } from "@/components/ui/button";

/** 403: a signed-in staff member opened an admin page their role can't use. */
export default function Forbidden() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Not available for your role</h1>
      <p className="text-muted-foreground">Ask the owner if you need access to this page.</p>
      <Button asChild>
        <Link href="/admin">Back to the dashboard</Link>
      </Button>
    </main>
  );
}
