import "server-only";

import { z } from "zod";

import type { MarketingTopic } from "./catalog";

export const unsubscribeParams = z.object({
  token: z.uuid(),
  topic: z.enum(["menu_published", "cutoff_reminders", "all"]),
});
export type UnsubscribeTopic = MarketingTopic | "all";
