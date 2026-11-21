import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-ink/40 bg-paper p-8 text-center">
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const PILL: Record<string, string> = {
  draft: "bg-muted",
  scheduled: "bg-accent",
  published: "bg-orange",
  closed: "bg-ink text-paper",
  fulfilled: "bg-paper",
  active: "bg-orange",
  archived: "bg-muted",
  pending: "bg-accent",
  approved: "bg-orange",
  suspended: "bg-ink text-paper",
  rejected: "bg-muted",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold capitalize ${PILL[status] ?? "bg-paper"}`}
    >
      {label ?? status}
    </span>
  );
}
