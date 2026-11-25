"use client";

import { MessageCircleQuestion } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { sendFeedback } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * Pilot families only (Phase 10): "How was ordering this week?" (1–5 and a
 * comment) and "Something confusing?" (free text, with the page it was on).
 * Copy comes from the CMS (feedback.*).
 */
export function FeedbackWidget({ copy }: { copy: Record<string, string> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [confusing, setConfusing] = useState("");
  const [pending, start] = useTransition();
  const submit = (input: Parameters<typeof sendFeedback>[0], reset: () => void) =>
    start(async () => {
      const r = await sendFeedback(input);
      if (!r.ok) return void toast.error(r.message);
      toast.success(copy.thanks);
      reset();
      setOpen(false);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="fixed right-4 bottom-24 z-30 rounded-full border-2 border-ink bg-paper shadow-ink md:bottom-6"
        >
          <MessageCircleQuestion aria-hidden="true" /> {copy.button}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.intro}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rating) return void toast.error(copy.pick_rating);
            submit({ kind: "weekly", rating, comment, pagePath: path }, () => {
              setRating(null);
              setComment("");
            });
          }}
        >
          <fieldset>
            <legend className="mb-2 font-bold">{copy.weekly_question}</legend>
            <div className="flex gap-2" role="radiogroup" aria-label={copy.weekly_question}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="flex size-11 cursor-pointer items-center justify-center rounded-xl border-2 border-ink font-black has-checked:bg-orange has-focus-visible:ring-4 has-focus-visible:ring-ink/40"
                >
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    className="sr-only"
                    checked={rating === n}
                    onChange={() => setRating(n)}
                    aria-label={`${n} ${n === 1 ? copy.scale_low : n === 5 ? copy.scale_high : ""}`.trim()}
                  />
                  {n}
                </label>
              ))}
            </div>
            <p className="mt-1 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{copy.scale_low}</span>
              <span>{copy.scale_high}</span>
            </p>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="fb-comment">{copy.comment_label}</Label>
            <textarea
              id="fb-comment"
              className="min-h-20 w-full rounded-md border-2 border-ink bg-card p-2"
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {copy.send_rating}
          </Button>
        </form>
        <hr className="my-2 border-ink/30" />
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confusing.trim()) return void toast.error(copy.empty);
            submit({ kind: "confusing", comment: confusing, pagePath: path }, () => setConfusing(""));
          }}
        >
          <Label htmlFor="fb-confusing" className="font-bold">
            {copy.confusing_label}
          </Label>
          <textarea
            id="fb-confusing"
            className="min-h-20 w-full rounded-md border-2 border-ink bg-card p-2"
            maxLength={2000}
            value={confusing}
            onChange={(e) => setConfusing(e.target.value)}
            aria-describedby="fb-confusing-help"
          />
          <p id="fb-confusing-help" className="text-xs text-muted-foreground">
            {copy.confusing_help}
          </p>
          <Button type="submit" variant="outline" disabled={pending}>
            {copy.send_confusing}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
