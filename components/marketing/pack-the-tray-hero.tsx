"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { AppleSlices, Broccoli, Carrots, CookieMascot, Pasta } from "@/components/art/cartoons";
import { ShaderField } from "@/components/art/shader-field";

/**
 * The "one unmistakable moment" (docs/design-contract.md): a hand-built SVG
 * sequence scrubbed by scroll. The tray draws itself, food drops into each
 * compartment, the mascot pops up winking and a PACKED! stamp lands.
 * Under prefers-reduced-motion the finished tray is shown, without the long
 * scroll track.
 */
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const FOODS = [
  { key: "pasta", from: 0.18, to: 0.32, spin: -14 },
  { key: "broccoli", from: 0.32, to: 0.45, spin: 10 },
  { key: "apple", from: 0.45, to: 0.57, spin: -18 },
  { key: "carrots", from: 0.57, to: 0.69, spin: 16 },
] as const;

export function PackTheTrayHero({ children }: { children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const dividers = useRef<SVGGElement>(null);
  const foods = useRef<Record<string, SVGGElement | null>>({});
  const mascot = useRef<HTMLDivElement>(null);
  const mascotWink = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = section.current;
    const path = outline.current;
    if (!el || !path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const render = (p: number) => {
      // 1. Tray outline draws, compartments appear.
      path.style.strokeDashoffset = `${length * (1 - easeOutCubic(seg(p, 0, 0.16)))}`;
      if (dividers.current) dividers.current.style.opacity = `${seg(p, 0.1, 0.18)}`;
      // 2. Food drops in with a cartoon bounce.
      for (const food of FOODS) {
        const g = foods.current[food.key];
        if (!g) continue;
        const t = seg(p, food.from, food.to);
        const y = (1 - easeOutBack(t)) * -320;
        const r = (1 - t) * food.spin;
        g.setAttribute("transform", `translate(0 ${y.toFixed(1)}) rotate(${r.toFixed(1)} 220 150)`);
        g.style.opacity = t > 0 ? "1" : "0";
      }
      // 3. Mascot pops up, then winks.
      const m = easeOutBack(seg(p, 0.7, 0.8));
      if (mascot.current)
        mascot.current.style.transform = `translateY(${(1 - m) * 60}%) scale(${0.4 + 0.6 * m}) rotate(${(1 - m) * -20 + 8}deg)`;
      if (mascot.current) mascot.current.style.opacity = `${seg(p, 0.7, 0.74)}`;
      const winking = p > 0.9;
      if (mascotWink.current) mascotWink.current.style.opacity = winking ? "1" : "0";
      // 4. PACKED! stamp slams down.
      const s = seg(p, 0.82, 0.9);
      if (stamp.current) {
        stamp.current.style.opacity = s > 0 ? "1" : "0";
        stamp.current.style.transform = `rotate(-11deg) scale(${2.4 - 1.4 * easeOutCubic(s)})`;
      }
      if (hint.current) hint.current.style.opacity = `${1 - seg(p, 0.02, 0.1)}`;
      if (caption.current) caption.current.dataset.done = p > 0.88 ? "true" : "false";
    };

    if (reduced) {
      render(1);
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const track = el.offsetHeight - window.innerHeight;
      render(track > 0 ? clamp(-rect.top / track) : 1);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section
      ref={section}
      aria-labelledby="hero-title"
      className="relative h-[230svh] border-b-2 border-ink motion-reduce:h-auto md:h-[260svh]"
    >
      <div className="sticky top-(--header-h) flex h-[calc(100svh-var(--header-h))] items-center overflow-hidden motion-reduce:relative motion-reduce:h-auto motion-reduce:min-h-[calc(100svh-var(--header-h))]">
        {/* On phones, keep the dots around the tray, not behind the text. */}
        <ShaderField className="max-md:[mask-image:linear-gradient(to_bottom,transparent_42%,black_68%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl grid-cols-12 items-center gap-x-4 gap-y-5 px-4 pt-4 pb-14 md:gap-y-8 md:py-0">
          <div className="col-span-12 md:col-span-6 md:col-start-1 md:-mr-10 lg:-mr-16">{children}</div>

          <div className="relative col-span-12 mx-auto w-full max-w-[19rem] sm:max-w-[26rem] md:col-span-6 md:col-start-7 md:mt-10 md:max-w-[34rem]">
            <div className="relative rotate-[2deg] rounded-[1.2rem] border-2 border-ink bg-paper p-2.5 shadow-ink-lg sm:rounded-[1.6rem] sm:p-5">
              <svg viewBox="0 0 440 300" className="block h-auto w-full overflow-visible" aria-hidden="true">
                <rect x="10" y="10" width="420" height="280" rx="36" fill="var(--concrete)" />
                <path
                  ref={outline}
                  d="M 46 10 H 394 A 36 36 0 0 1 430 46 V 254 A 36 36 0 0 1 394 290 H 46 A 36 36 0 0 1 10 254 V 46 A 36 36 0 0 1 46 10 Z"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="5"
                />
                <g ref={dividers} style={{ opacity: 0 }}>
                  <rect
                    x="30"
                    y="30"
                    width="190"
                    height="240"
                    rx="22"
                    fill="var(--paper)"
                    stroke="var(--ink)"
                    strokeWidth="4"
                  />
                  <rect
                    x="235"
                    y="30"
                    width="175"
                    height="110"
                    rx="20"
                    fill="var(--paper)"
                    stroke="var(--ink)"
                    strokeWidth="4"
                  />
                  <rect
                    x="235"
                    y="155"
                    width="82"
                    height="115"
                    rx="18"
                    fill="var(--paper)"
                    stroke="var(--ink)"
                    strokeWidth="4"
                  />
                  <rect
                    x="328"
                    y="155"
                    width="82"
                    height="115"
                    rx="18"
                    fill="var(--paper)"
                    stroke="var(--ink)"
                    strokeWidth="4"
                  />
                </g>
                <g ref={(n) => void (foods.current.pasta = n)} style={{ opacity: 0 }}>
                  <Pasta x={35} y={40} width={180} height={220} />
                </g>
                <g ref={(n) => void (foods.current.broccoli = n)} style={{ opacity: 0 }}>
                  <Broccoli x={238} y={38} width={168} height={96} />
                </g>
                <g ref={(n) => void (foods.current.apple = n)} style={{ opacity: 0 }}>
                  <AppleSlices x={236} y={158} width={80} height={108} />
                </g>
                <g ref={(n) => void (foods.current.carrots = n)} style={{ opacity: 0 }}>
                  <Carrots x={329} y={158} width={80} height={108} />
                </g>
              </svg>

              <div
                ref={mascot}
                className="absolute -top-10 -right-4 w-[4.5rem] origin-bottom sm:-top-16 sm:-right-8 sm:w-32"
                style={{ opacity: 0 }}
              >
                <CookieMascot className="h-auto w-full drop-shadow-[3px_3px_0_var(--ink)]" />
                <div ref={mascotWink} className="absolute inset-0" style={{ opacity: 0 }}>
                  <CookieMascot wink className="h-auto w-full" />
                </div>
              </div>

              <div
                ref={stamp}
                aria-hidden="true"
                className="absolute -bottom-5 -left-3 rounded-md border-[3px] border-ink bg-orange px-3 py-0.5 font-display text-2xl font-black tracking-tight text-ink italic shadow-ink sm:-bottom-6 sm:-left-4 sm:px-4 sm:py-1 sm:text-4xl"
                style={{ opacity: 0 }}
              >
                PACKED!
              </div>
            </div>

            <p
              ref={caption}
              data-done="false"
              className="group mt-8 hidden text-center text-sm font-semibold tracking-wide text-muted-foreground uppercase sm:block md:mt-10"
            >
              <span className="group-data-[done=true]:hidden">Monday · Mac &amp; cheese, broccoli, apple, carrots</span>
              <span className="hidden group-data-[done=true]:inline">
                Lunch packed. Allergies checked for every child.
              </span>
            </p>
          </div>
        </div>

        <p
          ref={hint}
          aria-hidden="true"
          className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 py-1.5 text-sm font-semibold shadow-ink-sm motion-reduce:hidden"
        >
          Scroll to pack lunch <ArrowDown className="size-4 animate-bounce" />
        </p>
      </div>
    </section>
  );
}
