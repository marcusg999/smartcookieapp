import type { ContentDef, ContentGroup } from "./registry.ts";

// Phase 10: the pilot feedback widget (shown to pilot families only).
const t = (key: string, def: string, label: string): ContentDef => ({ key, label, type: "text", default: def });

export const PILOT_CONTENT_GROUPS: ContentGroup[] = [
  {
    id: "pilot_feedback",
    label: "Pilot: feedback button",
    items: [
      t("feedback.button", "Feedback", "Button"),
      t("feedback.title", "Help us get this right", "Dialog heading"),
      t(
        "feedback.intro",
        "You're one of our founding families. Your feedback goes straight to Hannah.",
        "Dialog intro",
      ),
      t("feedback.weekly_question", "How was ordering this week?", "Rating question"),
      t("feedback.scale_low", "Hard", "Rating: low end"),
      t("feedback.scale_high", "Easy", "Rating: high end"),
      t("feedback.pick_rating", "Pick a number from 1 to 5 first.", "Missing rating"),
      t("feedback.comment_label", "Anything to add? (optional)", "Comment label"),
      t("feedback.send_rating", "Send rating", "Send rating button"),
      t("feedback.confusing_label", "Something confusing?", "Confusing label"),
      t(
        "feedback.confusing_help",
        "We'll see which page you were on, so you don't need to explain where.",
        "Confusing help",
      ),
      t("feedback.send_confusing", "Send", "Send note button"),
      t("feedback.empty", "Write a few words first.", "Empty note"),
      t("feedback.thanks", "Thank you! We read every one.", "Thanks message"),
    ],
  },
];
