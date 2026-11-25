import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getContent } from "@/lib/content/content";
import { unsubscribeParams } from "@/lib/email/unsubscribe";
import { createClient } from "@/lib/supabase/server";

import { confirmUnsubscribe } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/**
 * Where the unsubscribe link in optional emails lands. Opening it changes
 * nothing (link scanners open links too); the button does.
 */
export default async function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  const sp = await searchParams;
  const c = await getContent();
  const parsed = unsubscribeParams.safeParse({ token: sp.token, topic: sp.topic });
  let state: "ask" | "done" | "invalid" = sp.status === "done" ? "done" : "invalid";
  if (!sp.status && parsed.success) {
    // Only checks the token exists; shows nothing about the person.
    const { data } = await (await createClient()).rpc("email_preferences_by_token", { p_token: parsed.data.token });
    state = data && (data as unknown[]).length ? "ask" : "invalid";
  }
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-16">
      <div className="rounded-2xl border-2 border-ink bg-paper p-6 shadow-ink-lg">
        <h1 className="text-4xl font-black">{c.text("unsub.title")}</h1>
        {state === "ask" && parsed.success ? (
          <form action={confirmUnsubscribe} className="mt-4 space-y-4">
            <p className="text-lg">
              {c.text(
                parsed.data.topic === "menu_published"
                  ? "unsub.confirm_menu_published"
                  : "unsub.confirm_cutoff_reminders",
              )}
            </p>
            <input type="hidden" name="token" value={parsed.data.token} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="topic" value={parsed.data.topic}>
                {c.text("unsub.button")}
              </Button>
              <Button type="submit" name="topic" value="all" variant="outline">
                {c.text("unsub.all")}
              </Button>
            </div>
          </form>
        ) : (
          <p role="status" className="mt-4 text-lg">
            {c.text(state === "done" ? "unsub.done" : "unsub.invalid")}
          </p>
        )}
        <p className="mt-6">
          <Link href="/account/notifications" className="font-bold underline underline-offset-4">
            {c.text("unsub.manage")}
          </Link>
        </p>
      </div>
    </section>
  );
}
