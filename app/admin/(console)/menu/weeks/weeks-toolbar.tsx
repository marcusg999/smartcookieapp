"use client";

import { CalendarPlus, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createWeek, generateDraftWeeks } from "./actions";

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export function WeeksToolbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(nextMonday());
  return (
    <>
      <Button
        variant="outline"
        onClick={async () => {
          const r = await generateDraftWeeks();
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
          router.refresh();
        }}
      >
        <Wand2 aria-hidden="true" /> Generate drafts from rotation
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <CalendarPlus aria-hidden="true" /> New week
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a week</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="week-start">Monday of the week</Label>
            <Input id="week-start" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                const r = await createWeek({ week_start: date });
                if (!r.ok) return toast.error(r.message);
                toast.success(r.message);
                setOpen(false);
                const id = (r as { data?: { id: string } }).data?.id;
                if (id) router.push(`/admin/menu/weeks/${id}`);
              }}
            >
              Create week
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
