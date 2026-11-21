import { Construction } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getContent } from "@/lib/content/content";

/** Placeholder content for routes that later phases will build out. */
export async function PlaceholderPage({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase?: number;
}) {
  const c = await getContent();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Construction aria-hidden="true" className="size-4 text-primary" />
            {c.text("account.coming_soon")}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {phase ? <CardContent className="text-sm text-muted-foreground">Phase {phase}</CardContent> : null}
      </Card>
    </div>
  );
}
