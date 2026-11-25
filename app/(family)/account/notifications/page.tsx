import { EmailPrefsForm } from "@/components/account/email-prefs-form";
import { requireUser } from "@/lib/auth/guards";
import { getContent } from "@/lib/content/content";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Email preferences" };

export default async function NotificationsPage() {
  const user = await requireUser("/account/notifications");
  const [c, { data }] = await Promise.all([
    getContent(),
    (await createClient())
      .from("email_preferences")
      .select("menu_published, cutoff_reminders")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <h1 className="text-4xl leading-[0.95] font-black md:text-5xl">{c.text("notify.title")}</h1>
      <p>{c.text("notify.intro")}</p>
      <EmailPrefsForm
        initial={{ menu_published: data?.menu_published ?? true, cutoff_reminders: data?.cutoff_reminders ?? true }}
        copy={c.group("notify.")}
      />
    </div>
  );
}
