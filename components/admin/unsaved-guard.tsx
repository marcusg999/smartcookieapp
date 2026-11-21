"use client";

import { useEffect } from "react";

/** Warns before leaving the page with unsaved changes (tab close, reload, back). */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export function UnsavedBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
}) {
  if (!dirty && !saving) return null;
  return (
    <div
      className="sticky bottom-3 z-30 mt-6 flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-ink px-4 py-3 text-paper shadow-ink"
      role="region"
      aria-label="Unsaved changes"
    >
      <span className="text-sm font-semibold">{saving ? "Saving…" : "You have unsaved changes"}</span>
      <div className="flex gap-2">
        {onDiscard ? (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-semibold underline underline-offset-4"
          >
            Discard
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md border-2 border-paper bg-orange px-4 py-2 text-sm font-bold text-ink"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
