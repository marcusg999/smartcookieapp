"use client";

import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import { archiveClassroom, reviewLink, saveAllergyCounts, saveClassroom } from "@/app/(school)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AllergyCount, Classroom, RosterChild } from "@/lib/school/queries";

import { AllergenChips, Field, fmt, Panel, useRun, type Copy } from "./kit";

type Allergen = { id: string; name: string };

const blank = { name: "", teacher_name: "", grade: "", headcount: 0, dropoff_location: "" };

export function ClassroomsManager({
  copy,
  isAdmin,
  classrooms,
  allergens,
  summary,
  roster,
}: {
  copy: Copy;
  isAdmin: boolean;
  classrooms: Classroom[];
  allergens: Allergen[];
  summary: AllergyCount[];
  roster: RosterChild[];
}) {
  const [adding, setAdding] = useState(false);
  const { pending, run } = useRun(copy);
  const pendingKids = roster.filter((r) => r.link_status === "pending");
  const roomName = (id: string | null) => classrooms.find((c) => c.id === id)?.name ?? copy["classrooms.no_room"];
  return (
    <div className="space-y-6">
      {isAdmin && pendingKids.length > 0 ? (
        <Panel className="border-allergy">
          <h2 className="text-xl font-bold">{copy["classrooms.requests_title"]}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{copy["classrooms.requests_body"]}</p>
          <ul className="divide-y-2 divide-ink/10">
            {pendingKids.map((k) => (
              <li key={k.child_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">
                    {k.first_name} {k.last_initial ? `${k.last_initial}.` : ""}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">· {roomName(k.classroom_id)}</span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => reviewLink({ child_id: k.child_id, approve: true }), copy["classrooms.approved"])
                    }
                  >
                    <Check aria-hidden="true" /> {copy["classrooms.approve"]}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => reviewLink({ child_id: k.child_id, approve: false }), copy["classrooms.declined"])
                    }
                  >
                    <X aria-hidden="true" /> {copy["classrooms.decline"]}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {classrooms.length === 0 ? <p className="text-muted-foreground">{copy["classrooms.empty"]}</p> : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {classrooms.map((room) => (
          <RoomCard
            key={room.id}
            copy={copy}
            isAdmin={isAdmin}
            room={room}
            allergens={allergens}
            counts={summary.filter((s) => s.classroom_id === room.id)}
            kids={roster.filter((r) => r.classroom_id === room.id && r.link_status === "approved")}
          />
        ))}
      </ul>

      {isAdmin ? (
        adding ? (
          <Panel>
            <h2 className="mb-3 text-xl font-bold">{copy["classrooms.add_title"]}</h2>
            <RoomForm copy={copy} initial={blank} onDone={() => setAdding(false)} />
          </Panel>
        ) : (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> {copy["classrooms.add"]}
          </Button>
        )
      ) : null}
    </div>
  );
}

function RoomCard({
  copy,
  isAdmin,
  room,
  allergens,
  counts,
  kids,
}: {
  copy: Copy;
  isAdmin: boolean;
  room: Classroom;
  allergens: Allergen[];
  counts: AllergyCount[];
  kids: RosterChild[];
}) {
  const [editing, setEditing] = useState(false);
  const [editingCounts, setEditingCounts] = useState(false);
  const { pending, run } = useRun(copy);
  const summary = counts
    .map((c) => ({ name: c.allergen_name, n: c.linked_count + c.manual_count }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.name}`);
  return (
    <Panel as="li" className="space-y-3">
      {editing ? (
        <RoomForm
          copy={copy}
          initial={{
            id: room.id,
            name: room.name,
            teacher_name: room.teacher_name ?? "",
            grade: room.grade ?? "",
            headcount: room.headcount,
            dropoff_location: room.dropoff_location ?? "",
          }}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">{room.name}</h2>
              <p className="text-sm text-muted-foreground">
                {[
                  room.teacher_name,
                  room.grade ? fmt(copy["classrooms.grade"], { grade: room.grade }) : null,
                  room.dropoff_location,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <p className="shrink-0 rounded-xl border-2 border-ink bg-orange-tint px-3 py-1 text-center">
              <span className="block text-2xl font-black">{room.headcount}</span>
              <span className="text-xs font-semibold">{copy["classrooms.headcount"]}</span>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{copy["classrooms.allergy_summary"]}</h3>
            {summary.length ? (
              <AllergenChips names={summary} className="mt-1" />
            ) : (
              <p className="text-sm text-muted-foreground">{copy["classrooms.no_allergies"]}</p>
            )}
          </div>
          {kids.length ? (
            <div>
              <h3 className="text-sm font-semibold">{copy["classrooms.linked_kids"]}</h3>
              <ul className="mt-1 space-y-1">
                {kids.map((k) => (
                  <li key={k.child_id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">
                      {k.first_name} {k.last_initial ? `${k.last_initial}.` : ""}
                    </span>
                    <AllergenChips names={k.allergens} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {isAdmin ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> {copy["classrooms.edit"]}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingCounts((v) => !v)}
                aria-expanded={editingCounts}
              >
                {copy["classrooms.edit_counts"]}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(fmt(copy["classrooms.archive_confirm"], { name: room.name }))) {
                    run(() => archiveClassroom({ id: room.id }), copy["classrooms.archived"]);
                  }
                }}
              >
                {copy["classrooms.archive"]}
              </Button>
            </div>
          ) : null}
          {editingCounts ? (
            <CountsForm
              copy={copy}
              classroomId={room.id}
              allergens={allergens}
              initial={Object.fromEntries(counts.map((c) => [c.allergen_id, c.manual_count]))}
              onDone={() => setEditingCounts(false)}
            />
          ) : null}
        </>
      )}
    </Panel>
  );
}

function RoomForm({
  copy,
  initial,
  onDone,
}: {
  copy: Copy;
  initial: typeof blank & { id?: string };
  onDone: () => void;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useRun(copy);
  const key = initial.id ?? "new";
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveClassroom(v),
          copy["classrooms.saved"],
          (r) => {
            setErrors(r.fieldErrors ?? {});
            if (r.ok) onDone();
          },
        );
      }}
    >
      <Field id={`room-name-${key}`} label={copy["classrooms.name"]} error={errors.name}>
        <Input id={`room-name-${key}`} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      </Field>
      <Field id={`room-teacher-${key}`} label={copy["classrooms.teacher"]}>
        <Input
          id={`room-teacher-${key}`}
          value={v.teacher_name}
          onChange={(e) => setV({ ...v, teacher_name: e.target.value })}
        />
      </Field>
      <Field id={`room-grade-${key}`} label={copy["classrooms.grade_label"]}>
        <Input id={`room-grade-${key}`} value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} />
      </Field>
      <Field id={`room-count-${key}`} label={copy["classrooms.headcount"]} error={errors.headcount}>
        <Input
          id={`room-count-${key}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          value={v.headcount}
          onChange={(e) => setV({ ...v, headcount: Number(e.target.value) })}
        />
      </Field>
      <Field
        id={`room-loc-${key}`}
        label={copy["classrooms.location"]}
        hint={copy["classrooms.location_hint"]}
        className="sm:col-span-2"
      >
        <Input
          id={`room-loc-${key}`}
          value={v.dropoff_location}
          onChange={(e) => setV({ ...v, dropoff_location: e.target.value })}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {copy["classrooms.save"]}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

function CountsForm({
  copy,
  classroomId,
  allergens,
  initial,
  onDone,
}: {
  copy: Copy;
  classroomId: string;
  allergens: Allergen[];
  initial: Record<string, number>;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  const { pending, run } = useRun(copy);
  return (
    <form
      className="rounded-xl border-2 border-ink/20 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveAllergyCounts({
              classroom_id: classroomId,
              counts: Object.entries(counts).map(([allergen_id, count]) => ({ allergen_id, count: count || 0 })),
            }),
          copy["classrooms.counts_saved"],
          (r) => r.ok && onDone(),
        );
      }}
    >
      <p className="mb-2 text-sm text-muted-foreground">{copy["classrooms.counts_help"]}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {allergens.map((a) => (
          <Field key={a.id} id={`count-${classroomId}-${a.id}`} label={a.name}>
            <Input
              id={`count-${classroomId}-${a.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              value={counts[a.id] ?? 0}
              onChange={(e) => setCounts({ ...counts, [a.id]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      <Button type="submit" size="sm" className="mt-3" disabled={pending}>
        {copy["classrooms.save_counts"]}
      </Button>
    </form>
  );
}
