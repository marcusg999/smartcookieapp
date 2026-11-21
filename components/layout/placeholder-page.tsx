import { Construction } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder content for routes that later phases will build out. */
export function PlaceholderPage({ title, description, phase }: { title: string; description: string; phase?: number }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Construction aria-hidden="true" className="size-4 text-primary" />
            Coming soon
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {phase ? <CardContent className="text-sm text-muted-foreground">Planned for phase {phase}.</CardContent> : null}
      </Card>
    </div>
  );
}
