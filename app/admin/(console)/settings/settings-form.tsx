"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ChipToggle, Field } from "@/components/admin/fields";
import { UnsavedBar, useUnsavedGuard } from "@/components/admin/unsaved-guard";
import { MealImage } from "@/components/menu/meal-image";
import { useStepUp } from "@/components/mfa/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brandContrastProblems } from "@/lib/contrast";

import { saveSettings, uploadLogo, type SettingsInput } from "./actions";

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-4 rounded-2xl border-2 border-ink bg-paper p-5" aria-label={title}>
    <h2 className="text-xl font-bold">{title}</h2>
    {children}
  </section>
);

const COLOR_LABELS: Record<keyof SettingsInput["brand_colors"], string> = {
  primary: "Buttons & highlights",
  background: "Page background",
  surface: "Cards",
  ink: "Text & outlines",
  accent: "Accent text",
};

export function SettingsForm({ settings }: { settings: SettingsInput }) {
  const router = useRouter();
  const runWithStepUp = useStepUp();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(JSON.stringify(settings));
  const [saving, setSaving] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const dirty = useMemo(() => JSON.stringify(s) !== saved, [s, saved]);
  useUnsavedGuard(dirty);
  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const problems = brandContrastProblems(s.brand_colors);

  return (
    <div className="space-y-6">
      <Section title="Business">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bn" label="Business name">
            <Input
              id="bn"
              value={s.business_name}
              maxLength={80}
              onChange={(e) => set("business_name", e.target.value)}
            />
          </Field>
          <Field id="tz" label="Timezone" help="Cutoffs and delivery days use this timezone.">
            <select
              id="tz"
              value={s.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              className="h-11 w-full rounded-md border-2 border-ink bg-card px-3"
            >
              {["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Pacific/Honolulu"].map(
                (tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("_", " ")}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field id="ce" label="Contact email">
            <Input
              id="ce"
              type="email"
              value={s.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
            />
          </Field>
          <Field id="cp" label="Contact phone">
            <Input id="cp" value={s.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
          </Field>
          {(["instagram", "facebook", "tiktok"] as const).map((k) => (
            <Field key={k} id={`soc-${k}`} label={`${k[0]!.toUpperCase()}${k.slice(1)} link`}>
              <Input
                id={`soc-${k}`}
                value={s.social_links[k]}
                placeholder="https://"
                onChange={(e) => set("social_links", { ...s.social_links, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Logo & colours">
        <div className="flex flex-wrap items-center gap-4">
          {s.logo_path ? (
            <MealImage
              path={s.logo_path}
              alt="Current logo"
              bucket="media"
              className="size-24 rounded-full border-2 border-ink"
              sizes="96px"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No logo uploaded yet (the cookie mascot is shown).</p>
          )}
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/webp,image/jpeg,image/avif"
            className="sr-only"
            aria-label="Choose a logo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("file", f);
              const r = await uploadLogo(fd);
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              set("logo_path", (r as { data?: { path: string } }).data?.path ?? null);
            }}
          />
          <Button variant="outline" onClick={() => logoRef.current?.click()}>
            <Upload aria-hidden="true" /> Upload logo
          </Button>
          {s.logo_path ? (
            <Button variant="ghost" onClick={() => set("logo_path", null)}>
              Use the mascot instead
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          {(Object.keys(COLOR_LABELS) as (keyof SettingsInput["brand_colors"])[]).map((k) => (
            <label key={k} className="space-y-1 text-sm font-semibold">
              {COLOR_LABELS[k]}
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  value={s.brand_colors[k]}
                  onChange={(e) => set("brand_colors", { ...s.brand_colors, [k]: e.target.value })}
                  className="h-11 w-14 cursor-pointer rounded border-2 border-ink"
                />
                <code className="text-xs">{s.brand_colors[k]}</code>
              </span>
            </label>
          ))}
        </div>
        <div
          className="rounded-xl border-2 p-4"
          style={{ background: s.brand_colors.background, borderColor: s.brand_colors.ink, color: s.brand_colors.ink }}
        >
          <p className="font-bold">Preview</p>
          <div
            className="mt-2 rounded-lg border-2 p-3"
            style={{ background: s.brand_colors.surface, borderColor: s.brand_colors.ink }}
          >
            Card text <span style={{ color: s.brand_colors.accent }}>with an accent</span>
            <span
              className="ml-3 inline-block rounded-md border-2 px-3 py-1 font-bold"
              style={{ background: s.brand_colors.primary, borderColor: s.brand_colors.ink }}
            >
              Button
            </span>
          </div>
        </div>
        {problems.length ? (
          <ul role="alert" className="list-disc pl-5 text-sm font-semibold text-destructive">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">✓ All text is easy to read with these colours.</p>
        )}
      </Section>

      <Section title="Ordering">
        <ChipToggle pressed={s.ordering_enabled} onPressedChange={(v) => set("ordering_enabled", v)}>
          {s.ordering_enabled ? "Ordering is ON" : "Ordering is PAUSED"}
        </ChipToggle>
        <Field id="paused" label="Message while ordering is paused">
          <Input
            id="paused"
            value={s.ordering_paused_message}
            maxLength={300}
            onChange={(e) => set("ordering_paused_message", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="cut-days" label="Default cutoff: days before the week" help="4 = Thursday before a Monday start">
            <Input
              id="cut-days"
              type="number"
              min={0}
              max={28}
              value={s.default_cutoff_days_before}
              onChange={(e) => set("default_cutoff_days_before", Number(e.target.value))}
            />
          </Field>
          <Field id="cut-time" label="Default cutoff time">
            <Input
              id="cut-time"
              type="time"
              value={s.default_cutoff_time}
              onChange={(e) => set("default_cutoff_time", e.target.value)}
            />
          </Field>
          <Field id="opens" label="Ordering opens (days before)">
            <Input
              id="opens"
              type="number"
              min={1}
              max={60}
              value={s.ordering_opens_days_before}
              onChange={(e) => set("ordering_opens_days_before", Number(e.target.value))}
            />
          </Field>
        </div>
        <ChipToggle pressed={s.pilot_mode} onPressedChange={(v) => set("pilot_mode", v)}>
          {s.pilot_mode ? "Pilot mode on (invite only)" : "Pilot mode off"}
        </ChipToggle>
      </Section>

      <Section title="Announcement banner">
        <ChipToggle
          pressed={s.announcement.enabled}
          onPressedChange={(v) => set("announcement", { ...s.announcement, enabled: v })}
        >
          {s.announcement.enabled ? "Banner shown" : "Banner hidden"}
        </ChipToggle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ann-t" label="Banner text">
            <Input
              id="ann-t"
              value={s.announcement.text}
              maxLength={200}
              onChange={(e) => set("announcement", { ...s.announcement, text: e.target.value })}
            />
          </Field>
          <Field id="ann-l" label="Banner link (optional)">
            <Input
              id="ann-l"
              value={s.announcement.link}
              placeholder="/menu"
              onChange={(e) => set("announcement", { ...s.announcement, link: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Tax">
        <p className="text-sm text-muted-foreground">Changing tax settings asks for your authenticator code.</p>
        <div className="flex flex-wrap gap-2">
          <ChipToggle
            pressed={s.tax_settings.enabled}
            onPressedChange={(v) => set("tax_settings", { ...s.tax_settings, enabled: v })}
          >
            {s.tax_settings.enabled ? "Collect sales tax" : "No sales tax"}
          </ChipToggle>
          {s.tax_settings.enabled ? (
            <ChipToggle
              pressed={s.tax_settings.use_stripe_tax}
              onPressedChange={(v) => set("tax_settings", { ...s.tax_settings, use_stripe_tax: v })}
            >
              Calculate with Stripe Tax
            </ChipToggle>
          ) : null}
        </div>
      </Section>

      <UnsavedBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(JSON.parse(saved))}
        onSave={async () => {
          if (problems.length) return void toast.error(problems[0]);
          setSaving(true);
          const r = await runWithStepUp(() => saveSettings(s));
          setSaving(false);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setSaved(JSON.stringify(s));
          router.refresh();
        }}
      />
    </div>
  );
}
