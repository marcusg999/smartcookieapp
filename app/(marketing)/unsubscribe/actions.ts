"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { unsubscribeParams } from "@/lib/email/unsubscribe";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";

/** The confirm button on /unsubscribe. Works signed out: the token is the key. */
export async function confirmUnsubscribe(formData: FormData): Promise<void> {
  const parsed = unsubscribeParams.safeParse({ token: formData.get("token"), topic: formData.get("topic") });
  if (!parsed.success || !(await rateLimit("codeCheck", clientIp(await headers()))).success)
    redirect("/unsubscribe?status=invalid");
  const supabase = await createClient();
  const { data } = await supabase.rpc("email_unsubscribe", {
    p_token: parsed.data.token,
    p_category: parsed.data.topic,
  });
  redirect(data ? "/unsubscribe?status=done" : "/unsubscribe?status=invalid");
}
