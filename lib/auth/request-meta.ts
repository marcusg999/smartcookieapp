import "server-only";

import { headers } from "next/headers";

import { clientIp } from "@/lib/ratelimit";

export async function requestMeta() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent")?.slice(0, 512) ?? null };
}
