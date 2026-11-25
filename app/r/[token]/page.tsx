import { Repeat2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getContent } from "@/lib/content/content";

import { redeemRepeatLink } from "./actions";

export const metadata = { title: "Repeat last week", robots: { index: false, follow: false } };

/**
 * Landing for the email's "Repeat last week" button. The token is used only
 * when the button here is pressed: email security scanners open links
 * automatically, and a GET that spent the single-use token would break the
 * link before the parent ever tapped it.
 */
export default async function RepeatLinkPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const c = await getContent();
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        action={redeemRepeatLink}
        className="w-full max-w-md rounded-2xl border-2 border-ink bg-paper p-6 text-center shadow-ink-lg"
      >
        <Repeat2 aria-hidden="true" className="mx-auto size-10" />
        <h1 className="mt-3 text-3xl font-black">{c.text("order.repeat")}</h1>
        <input type="hidden" name="token" value={token.slice(0, 100)} />
        <Button type="submit" size="lg" className="mt-5 w-full">
          {c.text("order.repeat")}
        </Button>
      </form>
    </main>
  );
}
