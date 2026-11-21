"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border-2 !border-ink !bg-paper !text-ink !shadow-ink !font-sans",
          error: "!border-destructive",
        },
      }}
    />
  );
}
