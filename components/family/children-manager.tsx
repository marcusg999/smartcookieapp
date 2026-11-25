"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { removeChild } from "@/app/(family)/actions";
import { Button } from "@/components/ui/button";
import type { Child } from "@/lib/family/queries";

import { ChildForm, emptyChild, type ChildFormValue, type SchoolOption } from "./child-form";
import { AllergyChips, fmt, Panel, type Copy } from "./kit";

export function toFormValue(c: Child): ChildFormValue {
  return {
    id: c.id,
    firstName: c.first_name,
    lastInitial: c.last_initial ?? "",
    grade: c.grade ?? "",
    schoolId: c.school_id ?? "",
    classroomId: c.classroom_id ?? "",
    allergies: c.allergies.map((a) => ({ allergenId: a.allergenId, severity: a.severity })),
    dietary: c.dietary_preferences,
    notes: c.notes ?? "",
  };
}

export function ChildrenManager({
  copy,
  kids,
  allergens,
  badges,
  schools,
  startAdding = false,
  preferSchool = false,
}: {
  copy: Copy;
  kids: Child[];
  allergens: { id: string; name: string; is_top9: boolean }[];
  badges: { name: string }[];
  schools: SchoolOption[];
  startAdding?: boolean;
  preferSchool?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(startAdding || kids.length === 0 ? "new" : null);
  const [pending, start] = useTransition();
  const schoolName = (id: string | null) => schools.find((s) => s.organization_id === id)?.name;
  const roomName = (id: string | null) => schools.find((s) => s.classroom_id === id)?.classroom_name;

  const done = () => {
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {kids.length === 0 && editing !== "new" ? <p className="text-muted-foreground">{copy.empty}</p> : null}
      <ul className="space-y-4">
        {kids.map((k, i) => (
          <Panel as="li" key={k.id} className={i % 2 ? "md:rotate-[0.4deg]" : "md:-rotate-[0.4deg]"}>
            {editing === k.id ? (
              <ChildForm
                copy={copy}
                allergens={allergens}
                badges={badges}
                schools={schools}
                initial={toFormValue(k)}
                onSaved={done}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">
                    {k.first_name}
                    {k.last_initial ? ` ${k.last_initial}.` : ""}
                  </h2>
                  {k.school_id ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {[schoolName(k.school_id), roomName(k.classroom_id), k.grade].filter(Boolean).join(" · ")}
                      </p>
                      {k.school_link_status ? (
                        <p
                          className={`text-xs font-semibold ${k.school_link_status === "rejected" ? "text-destructive" : "text-muted-foreground"}`}
                          title={copy.link_help}
                        >
                          {copy[`link_${k.school_link_status}`]}
                        </p>
                      ) : null}
                    </>
                  ) : k.grade ? (
                    <p className="text-sm text-muted-foreground">{k.grade}</p>
                  ) : null}
                  <AllergyChips allergies={k.allergies} emptyLabel={copy.no_allergies} />
                  {k.dietary_preferences.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {k.dietary_preferences.map((d) => (
                        <li
                          key={d}
                          className="rounded-full border-2 border-ink bg-orange-tint px-2 py-0.5 text-xs font-semibold"
                        >
                          {d}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(k.id)}>
                    <Pencil aria-hidden="true" /> {copy.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(fmt(copy.remove_confirm, { name: k.first_name }))) return;
                      start(async () => {
                        const res = await removeChild({ id: k.id });
                        if (!res.ok) toast.error(res.message);
                        router.refresh();
                      });
                    }}
                  >
                    <Trash2 aria-hidden="true" /> <span className="sr-only sm:not-sr-only">{copy.remove}</span>
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        ))}
      </ul>
      {editing === "new" ? (
        <Panel className="border-dashed">
          <ChildForm
            copy={copy}
            allergens={allergens}
            badges={badges}
            schools={schools}
            initial={emptyChild}
            preferSchool={preferSchool}
            onSaved={done}
            onCancel={kids.length ? () => setEditing(null) : undefined}
          />
        </Panel>
      ) : (
        <Button variant="outline" size="lg" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" /> {kids.length ? copy.add_another : copy.add}
        </Button>
      )}
    </div>
  );
}
