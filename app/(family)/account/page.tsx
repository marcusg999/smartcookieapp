import {
  Bookmark,
  CalendarCheck,
  CalendarX,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Repeat2,
  ShieldCheck,
  Smile,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { Countdown } from "@/components/family/kit";
import { fmt } from "@/lib/content/fmt";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { getPublicSettings } from "@/lib/content/settings";
import {
  getAllowance,
  getChildren,
  getHousehold,
  getOrderableWeeks,
  getProfile,
  getSubscription,
  getWeekOrder,
} from "@/lib/family/queries";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatInZone } from "@/lib/time";

export const metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser("/account");
  const sp = await searchParams;
  const supabase = await createClient();
  const [c, settings, household, profile, weeks, { data: passkeys }] = await Promise.all([
    getContent(),
    getPublicSettings().catch(() => null),
    getHousehold(),
    getProfile(user.id),
    getOrderableWeeks(),
    supabase.auth.passkey.list(),
  ]);
  const tz = settings?.timezone ?? "America/Los_Angeles";
  const firstName = profile?.full_name?.split(" ")[0];
  const kids = household ? await getChildren(household.id) : [];

  // First sign-in: go straight to the welcome steps (skippable).
  if (household && !household.onboarded_at && kids.length === 0 && sp.skip !== "1") redirect("/welcome");

  const week = weeks[0];
  const [order, sub] =
    household && week
      ? await Promise.all([getWeekOrder(household.id, week.id), getSubscription(household.id)])
      : [null, null];
  const allowance = sub && week ? await getAllowance(sub.id, week.id) : null;
  const status = order ? "ordered" : allowance?.skipped ? "skipped" : "not";

  const links = [
    { href: "/children", icon: Smile, title: c.text("acct.kids"), body: c.text("acct.kids_body") },
    { href: "/subscription", icon: Wallet, title: c.text("acct.subscription"), body: c.text("acct.subscription_body") },
    { href: "/account/addresses", icon: MapPin, title: c.text("acct.addresses"), body: c.text("acct.addresses_body") },
    {
      href: "/order#saved-orders",
      icon: Bookmark,
      title: c.text("acct.saved_orders"),
      body: c.text("acct.saved_orders_body"),
    },
    {
      href: "/account/security",
      icon: ShieldCheck,
      title: c.text("account.security.title"),
      body: c.text("account.security.body"),
    },
    {
      href: "/account/notifications",
      icon: Mail,
      title: c.text("account.notify.title"),
      body: c.text("account.notify.body"),
    },
    {
      href: "/account/privacy",
      icon: Lock,
      title: c.text("account.privacy.title"),
      body: c.text("account.privacy.body"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-[0.95] font-black md:text-5xl">
            {firstName ? c.text("account.greeting", { name: firstName }) : c.text("account.title")}
          </h1>
          <p className="mt-1 text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            {c.text("nav.sign_out")}
          </Button>
        </form>
      </div>

      {household && !household.onboarded_at ? (
        <Link
          href="/welcome"
          className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-orange p-4 font-bold shadow-ink transition-transform hover:-translate-y-0.5"
        >
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-5" /> {c.text("acct.finish_setup")}
          </span>
          <span className="underline">{c.text("acct.finish_setup_cta")}</span>
        </Link>
      ) : null}

      {week ? (
        <section
          aria-labelledby="week-h"
          className="rounded-3xl border-2 border-ink bg-paper p-5 shadow-ink-lg md:-rotate-[0.4deg]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="week-h" className="text-sm font-black uppercase">
                {c.text("acct.this_week")} · {formatDay(week.week_start, { month: "short", day: "numeric" })}
              </h2>
              <p className="mt-1 flex items-center gap-2 text-3xl font-black">
                {status === "ordered" ? (
                  <CalendarCheck aria-hidden="true" className="size-7" />
                ) : (
                  <CalendarX aria-hidden="true" className="size-7" />
                )}
                {status === "ordered"
                  ? c.text("acct.ordered")
                  : status === "skipped"
                    ? c.text("acct.skipped")
                    : c.text("acct.not_ordered")}
              </p>
              {week.cutoff ? (
                <p className="mt-1 text-sm font-semibold">
                  {fmt(c.text("order.cutoff"), {
                    date: formatInZone(week.cutoff, tz, { weekday: "short", hour: "numeric", minute: "2-digit" }),
                  })}{" "}
                  ·{" "}
                  <Countdown
                    cutoff={week.cutoff}
                    template={c.text("order.countdown")}
                    closedLabel={c.text("order.closed")}
                  />
                </p>
              ) : null}
            </div>
            {order ? (
              <Button asChild variant="outline">
                <Link href={`/orders/${order.id}`}>{order.order_number}</Link>
              </Button>
            ) : null}
          </div>
          <h3 className="sr-only">{c.text("acct.quick_actions")}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Button asChild size="lg">
              <Link href={`/order?week=${week.id}&repeat=1`}>
                <Repeat2 aria-hidden="true" /> {c.text("order.repeat")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={`/order?week=${week.id}`}>{c.text("acct.order_now")}</Link>
            </Button>
            {sub && sub.plan.allow_skip ? (
              <Button asChild size="lg" variant="outline">
                <Link href="/subscription">{c.text("order.skip_week")}</Link>
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-ink bg-paper p-4">{c.text("order.no_week")}</p>
      )}

      {(passkeys ?? []).length === 0 ? (
        <Link
          href="/account/security"
          className="flex items-start gap-3 rounded-2xl border-2 border-ink bg-orange-tint p-4"
        >
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>
            <span className="block font-bold">{c.text("account.passkey_offer.title")}</span>
            <span className="block text-sm">{c.text("account.passkey_offer.body")}</span>
          </span>
        </Link>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map(({ href, icon: Icon, title, body }, i) => (
          <li key={href}>
            <Link
              href={href}
              style={{ rotate: `${[-0.6, 0.5, -0.3, 0.7, -0.5, 0.4][i]}deg` }}
              className="flex h-full items-start gap-3 rounded-2xl border-2 border-ink bg-paper p-4 shadow-ink-sm transition-[rotate,translate,box-shadow] duration-200 hover:-translate-y-1 hover:rotate-0! hover:shadow-ink focus-visible:rotate-0!"
            >
              <Icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
              <span>
                <span className="block font-black">{title}</span>
                <span className="block text-sm text-muted-foreground">{body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
