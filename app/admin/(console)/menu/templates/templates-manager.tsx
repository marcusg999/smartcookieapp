"use client";

import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/admin/confirm";
import { Field } from "@/components/admin/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { archiveTemplate, saveRotation } from "../weeks/actions";

type T = { id: string; name: string; description: string | null; rotation_position: number | null; count: number };

export function TemplatesManager({
  templates,
  anchorWeek,
  weeksAhead,
}: {
  templates: T[];
  anchorWeek: string | null;
  weeksAhead: number;
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState(
    templates
      .filter((t) => t.rotation_position)
      .sort((a, b) => a.rotation_position! - b.rotation_position!)
      .map((t) => t.id),
  );
  const [anchor, setAnchor] = useState(anchorWeek ?? "");
  const [ahead, setAhead] = useState(weeksAhead);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const letter = (i: number) => String.fromCharCode(65 + i);

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-labelledby="rotation-h">
        <h2 id="rotation-h" className="text-xl font-bold">
          Rotation
        </h2>
        {cycle.length === 0 ? (
          <p className="text-muted-foreground">No templates in the rotation yet. Add some below.</p>
        ) : null}
        <ol className="space-y-2">
          {cycle.map((id, i) => (
            <li key={id} className="flex items-center gap-3 rounded-xl border-2 border-ink bg-card p-3">
              <span className="flex size-9 items-center justify-center rounded-full border-2 border-ink bg-orange font-display text-lg font-black">
                {letter(i)}
              </span>
              <span className="flex-1 font-semibold">{byId.get(id)?.name}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                aria-label="Earlier in rotation"
                onClick={() => setCycle(swap(cycle, i, i - 1))}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === cycle.length - 1}
                aria-label="Later in rotation"
                onClick={() => setCycle(swap(cycle, i, i + 1))}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove from rotation"
                onClick={() => setCycle(cycle.filter((x) => x !== id))}
              >
                <Minus className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="anchor" label="Week A starts on (a Monday)" help="Week B follows the week after, and so on.">
            <Input id="anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
          <Field id="ahead" label="Create drafts how many weeks ahead?">
            <Input
              id="ahead"
              type="number"
              min={0}
              max={12}
              value={ahead}
              onChange={(e) => setAhead(Number(e.target.value))}
            />
          </Field>
        </div>
        <Button
          onClick={async () => {
            const r = await saveRotation({ template_ids: cycle, anchor_week: anchor || null, weeks_ahead: ahead });
            r.ok ? toast.success(r.message) : toast.error(r.message);
            router.refresh();
          }}
        >
          Save rotation
        </Button>
        <p className="text-sm text-muted-foreground">
          Drafts are generated every weekend automatically. You can also generate them now from Weekly menus.
        </p>
      </section>

      <section aria-labelledby="all-h">
        <h2 id="all-h" className="mb-3 text-xl font-bold">
          All templates
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Create a template from any week with &ldquo;Save as template&rdquo; in the week builder.
        </p>
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-ink bg-paper p-3">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/menu/templates/${t.id}`} className="font-bold underline-offset-4 hover:underline">
                  {t.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {t.count} meals{t.description ? ` · ${t.description}` : ""}
                </p>
              </div>
              {!cycle.includes(t.id) ? (
                <Button size="sm" variant="outline" onClick={() => setCycle([...cycle, t.id])}>
                  <Plus aria-hidden="true" /> Add to rotation
                </Button>
              ) : null}
              <ConfirmButton
                trigger={
                  <Button size="sm" variant="ghost">
                    Archive
                  </Button>
                }
                title={`Archive "${t.name}"?`}
                body="It's removed from the rotation. Weeks already created from it are not changed."
                confirmLabel="Archive template"
                onConfirm={async () => {
                  const r = await archiveTemplate({ id: t.id });
                  r.ok ? toast.success(r.message) : toast.error(r.message);
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const next = [...arr];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}
