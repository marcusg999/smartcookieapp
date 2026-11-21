"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmButton } from "@/components/admin/confirm";
import { ChipToggle, Field } from "@/components/admin/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveClassroom, saveSchoolBilling, setSchoolStatus } from "../actions";

type School = {
  id: string;
  name: string;
  status: string;
  billing_email: string;
  billing_terms_days: number;
  tax_exempt: boolean;
  contact_phone: string;
  dropoff_instructions: string;
};
type Room = {
  id?: string;
  name: string;
  teacher_name: string;
  grade: string;
  headcount: number;
  dropoff_location: string;
};

export function SchoolEditor({ school, classrooms }: { school: School; classrooms: Room[] }) {
  const router = useRouter();
  const [s, setS] = useState(school);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(school);
  const status = async (next: "approved" | "rejected" | "suspended" | "pending") => {
    const r = await setSchoolStatus({ id: school.id, status: next });
    if (!r.ok) return void toast.error(r.message);
    toast.success(r.message);
    router.refresh();
  };
  const card = "space-y-4 rounded-2xl border-2 border-ink bg-paper p-5";

  return (
    <>
      <section className={card} aria-labelledby="approval">
        <h2 id="approval" className="text-xl font-bold">
          Approval
        </h2>
        <div className="flex flex-wrap gap-2">
          {school.status !== "approved" ? <Button onClick={() => status("approved")}>Approve school</Button> : null}
          {school.status === "pending" ? (
            <ConfirmButton
              trigger={<Button variant="outline">Decline</Button>}
              title={`Decline ${school.name}?`}
              body="They won't be able to order. You can approve them later."
              confirmLabel="Decline"
              onConfirm={() => status("rejected")}
            />
          ) : null}
          {school.status === "approved" ? (
            <ConfirmButton
              trigger={<Button variant="outline">Suspend</Button>}
              title={`Suspend ${school.name}?`}
              body="Their standing orders stop until you approve them again."
              confirmLabel="Suspend"
              onConfirm={() => status("suspended")}
            />
          ) : null}
        </div>
      </section>
      <section className={card} aria-labelledby="billing">
        <h2 id="billing" className="text-xl font-bold">
          Billing & drop-off
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="be" label="Billing email">
            <Input
              id="be"
              type="email"
              value={s.billing_email}
              onChange={(e) => setS({ ...s, billing_email: e.target.value })}
            />
          </Field>
          <Field id="terms" label="Payment terms (days)" help="Net 30 = 30">
            <Input
              id="terms"
              type="number"
              min={0}
              max={90}
              value={s.billing_terms_days}
              onChange={(e) => setS({ ...s, billing_terms_days: Number(e.target.value) })}
            />
          </Field>
          <Field id="phone" label="Contact phone">
            <Input id="phone" value={s.contact_phone} onChange={(e) => setS({ ...s, contact_phone: e.target.value })} />
          </Field>
        </div>
        <Field id="drop" label="Drop-off instructions">
          <textarea
            id="drop"
            rows={2}
            maxLength={1000}
            value={s.dropoff_instructions}
            onChange={(e) => setS({ ...s, dropoff_instructions: e.target.value })}
            className="w-full rounded-md border-2 border-ink bg-card p-2"
          />
        </Field>
        <ChipToggle pressed={s.tax_exempt} onPressedChange={(v) => setS({ ...s, tax_exempt: v })}>
          {s.tax_exempt ? "Tax exempt" : "Pays sales tax"}
        </ChipToggle>
        <div>
          <Button
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              const r = await saveSchoolBilling({
                id: s.id,
                billing_email: s.billing_email,
                billing_terms_days: s.billing_terms_days,
                tax_exempt: s.tax_exempt,
                contact_phone: s.contact_phone,
                dropoff_instructions: s.dropoff_instructions,
              });
              setBusy(false);
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              router.refresh();
            }}
          >
            Save details
          </Button>
        </div>
      </section>
      <section className={card} aria-labelledby="rooms">
        <h2 id="rooms" className="text-xl font-bold">
          Classrooms
        </h2>
        {classrooms.length === 0 && !adding ? <p className="text-muted-foreground">No classrooms yet.</p> : null}
        {classrooms.map((r) => (
          <RoomRow key={r.id} orgId={school.id} room={r} />
        ))}
        {adding ? (
          <RoomRow
            orgId={school.id}
            room={{ name: "", teacher_name: "", grade: "", headcount: 0, dropoff_location: "" }}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> Add classroom
          </Button>
        )}
      </section>
    </>
  );
}

function RoomRow({ orgId, room, onDone }: { orgId: string; room: Room; onDone?: () => void }) {
  const router = useRouter();
  const [r, setR] = useState(room);
  const dirty = JSON.stringify(r) !== JSON.stringify(room);
  const fid = (k: string) => `${room.id ?? "new"}-${k}`;
  return (
    <div className="grid items-end gap-3 rounded-xl border-2 border-ink/20 p-3 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]">
      <Field id={fid("n")} label="Classroom">
        <Input id={fid("n")} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      </Field>
      <Field id={fid("t")} label="Teacher">
        <Input id={fid("t")} value={r.teacher_name} onChange={(e) => setR({ ...r, teacher_name: e.target.value })} />
      </Field>
      <Field id={fid("g")} label="Grade">
        <Input id={fid("g")} value={r.grade} onChange={(e) => setR({ ...r, grade: e.target.value })} />
      </Field>
      <Field id={fid("h")} label="Students">
        <Input
          id={fid("h")}
          type="number"
          min={0}
          max={1000}
          value={r.headcount}
          onChange={(e) => setR({ ...r, headcount: Number(e.target.value) })}
        />
      </Field>
      <Button
        disabled={!dirty || !r.name.trim()}
        onClick={async () => {
          const res = await saveClassroom({ ...r, organization_id: orgId });
          if (!res.ok) return void toast.error(res.message);
          toast.success(res.message);
          onDone?.();
          router.refresh();
        }}
      >
        Save
      </Button>
    </div>
  );
}
