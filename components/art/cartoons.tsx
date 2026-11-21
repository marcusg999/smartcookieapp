/**
 * Hand-authored cartoon set: two-colour "screen print" in safety orange,
 * paper and ink, with halftone shading (docs/design-contract.md).
 * Decorative: every <svg> is aria-hidden; meaning always lives in real text.
 */
import type { SVGProps } from "react";

const INK = "var(--ink)";
const ORANGE = "var(--orange)";
const PAPER = "var(--paper)";

type ArtProps = SVGProps<SVGSVGElement> & { title?: string };

/** Shared defs: a halftone dot pattern used for shading. Render once per page. */
export function HalftoneDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <pattern id="sc-halftone" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <circle cx="3.5" cy="3.5" r="1.5" fill={INK} opacity="0.55" />
        </pattern>
        <pattern
          id="sc-halftone-orange"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(15)"
        >
          <circle cx="4" cy="4" r="2.1" fill={ORANGE} />
        </pattern>
      </defs>
    </svg>
  );
}

/** Macaroni: an elbow drawn as a thick ink stroke with an orange core. */
function Elbow({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  // A short, fat "C": reads as macaroni, not noodles.
  const d = "M -9 7 A 10 10 0 1 1 9 7";
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d={d} fill="none" stroke={INK} strokeWidth="19" strokeLinecap="round" />
      <path d={d} fill="none" stroke={ORANGE} strokeWidth="12" strokeLinecap="round" />
      <path
        d="M -6 -3 A 7 7 0 0 1 3 -8"
        fill="none"
        stroke={PAPER}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <ellipse cx="9" cy="7" rx="4.5" ry="3.5" fill={INK} transform="rotate(-40 9 7)" />
    </g>
  );
}

export function Pasta(props: ArtProps) {
  // A heaped mound, densest in the middle.
  const elbows: Array<[number, number, number]> = [
    [36, 70, -20],
    [70, 52, 40],
    [106, 48, 110],
    [140, 64, 200],
    [28, 108, 150],
    [62, 96, -60],
    [98, 88, 20],
    [134, 100, -130],
    [44, 142, 70],
    [80, 132, 190],
    [116, 136, -10],
    [150, 140, 100],
    [56, 178, -100],
    [92, 172, 30],
    [128, 176, 160],
  ];
  return (
    <svg viewBox="0 0 180 220" aria-hidden="true" focusable="false" {...props}>
      {elbows.map(([x, y, r], i) => (
        <Elbow key={i} x={x} y={y} r={r} />
      ))}
    </svg>
  );
}

export function Broccoli(props: ArtProps) {
  const tree = (x: number, s: number) => (
    <g transform={`translate(${x} 0) scale(${s})`}>
      <path d="M 28 92 L 34 54 L 46 54 L 52 92 Z" fill={PAPER} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M 28 92 L 34 54 L 40 54 L 36 92 Z" fill="url(#sc-halftone)" />
      {[
        [22, 44, 16],
        [40, 30, 19],
        [60, 44, 16],
        [32, 56, 13],
        [50, 56, 13],
      ].map(([cx, cy, r], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={r} fill={PAPER} stroke={INK} strokeWidth="4" />
          <circle cx={cx} cy={cy} r={r - 2} fill="url(#sc-halftone)" />
        </g>
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 170 100" aria-hidden="true" focusable="false" {...props}>
      {tree(4, 1)}
      {tree(78, 0.9)}
    </svg>
  );
}

export function AppleSlices(props: ArtProps) {
  const slice = (x: number, y: number, r: number) => (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d="M -26 0 A 26 26 0 0 0 26 0 Z" fill={PAPER} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M -26 0 A 26 26 0 0 0 26 0" fill="none" stroke={ORANGE} strokeWidth="7" />
      <path d="M -26 0 A 26 26 0 0 0 26 0" fill="none" stroke={INK} strokeWidth="4" />
      <ellipse cx="-6" cy="8" rx="2.5" ry="4" fill={INK} />
      <ellipse cx="6" cy="8" rx="2.5" ry="4" fill={INK} />
    </g>
  );
  return (
    <svg viewBox="0 0 80 110" aria-hidden="true" focusable="false" {...props}>
      {slice(40, 18, 0)}
      {slice(40, 52, 8)}
      {slice(40, 86, -6)}
    </svg>
  );
}

export function Carrots(props: ArtProps) {
  const stick = (x: number, r: number, h: number) => (
    <g transform={`translate(${x} 100) rotate(${r})`}>
      <rect x="-8" y={-h} width="16" height={h} rx="7" fill={ORANGE} stroke={INK} strokeWidth="4" />
      <path
        d={`M -3 ${-h + 14} L 2 ${-h + 14} M -2 ${-h / 2} L 3 ${-h / 2}`}
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
  );
  return (
    <svg viewBox="0 0 80 110" aria-hidden="true" focusable="false" {...props}>
      {stick(18, -8, 86)}
      {stick(40, 3, 94)}
      {stick(62, 11, 80)}
    </svg>
  );
}

export function Wrap(props: ArtProps) {
  // A wrap cut on the diagonal: tortilla roll with the filling showing at the cut.
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true" focusable="false" {...props}>
      <g transform="rotate(-14 80 55)">
        {/* tortilla body */}
        <path
          d="M 22 34 Q 20 55 24 78 L 112 84 L 118 28 Z"
          fill={PAPER}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M 22 34 Q 20 55 24 78 L 40 79 Q 34 56 38 33 Z" fill="url(#sc-halftone)" opacity="0.6" />
        {/* toasted spots */}
        <circle cx="60" cy="46" r="3" fill={ORANGE} stroke={INK} strokeWidth="2" />
        <circle cx="82" cy="66" r="2.5" fill={ORANGE} stroke={INK} strokeWidth="2" />
        <circle cx="94" cy="40" r="2" fill={ORANGE} stroke={INK} strokeWidth="2" />
        {/* the cut face */}
        <ellipse cx="116" cy="56" rx="20" ry="29" fill={PAPER} stroke={INK} strokeWidth="4" />
        <ellipse cx="116" cy="56" rx="14" ry="22" fill={ORANGE} stroke={INK} strokeWidth="3" />
        <path
          d="M 104 46 Q 112 40 120 46 Q 128 52 122 60 Q 116 68 108 62"
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M 104 62 q 4 -5 8 0 q 4 5 8 0 q 4 -5 8 0"
          fill="none"
          stroke={PAPER}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="114" cy="52" r="3" fill={PAPER} stroke={INK} strokeWidth="2" />
        {/* wrapper band */}
        <path
          d="M 52 31 L 50 80 L 70 82 L 72 30 Z"
          fill={ORANGE}
          stroke={INK}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path d="M 58 34 L 56 78" stroke={INK} strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** The Smart Cookie mascot. `wink` swaps the right eye for a closed arc. */
export function CookieMascot({ wink = false, ...props }: ArtProps & { wink?: boolean }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M60 6 C 86 6 112 24 113 56 C 114 90 92 114 60 114 C 26 114 7 92 7 60 C 7 30 30 6 60 6 Z"
        fill={ORANGE}
        stroke={INK}
        strokeWidth="5"
      />
      <path
        d="M60 6 C 86 6 112 24 113 56 C 100 30 78 18 60 18 C 40 18 18 30 9 52 C 12 26 34 6 60 6 Z"
        fill="url(#sc-halftone)"
        opacity="0.5"
      />
      {/* chocolate chips */}
      {[
        [28, 30, 6],
        [86, 26, 5],
        [96, 76, 6],
        [24, 82, 5],
        [62, 98, 4],
      ].map(([cx, cy, r], i) => (
        <path
          key={i}
          d={`M ${cx - r} ${cy} L ${cx} ${cy - r} L ${cx + r} ${cy + 1} L ${cx + 1} ${cy + r} Z`}
          fill={INK}
        />
      ))}
      {/* face */}
      <ellipse cx="44" cy="54" rx="8" ry="10" fill={PAPER} stroke={INK} strokeWidth="4" />
      <circle cx="46" cy="56" r="4" fill={INK} />
      {wink ? (
        <path d="M 68 56 Q 76 46 84 56" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      ) : (
        <>
          <ellipse cx="76" cy="54" rx="8" ry="10" fill={PAPER} stroke={INK} strokeWidth="4" />
          <circle cx="78" cy="56" r="4" fill={INK} />
        </>
      )}
      <path
        d="M 44 74 Q 60 90 78 74"
        fill={PAPER}
        stroke={INK}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="34" cy="72" r="5" fill={PAPER} opacity="0.7" />
      <circle cx="88" cy="72" r="5" fill={PAPER} opacity="0.7" />
    </svg>
  );
}

/** Small mark for the logo. */
export function CookieMark(props: ArtProps) {
  return <CookieMascot {...props} />;
}

export const MEAL_ART = {
  pasta: Pasta,
  broccoli: Broccoli,
  apple: AppleSlices,
  carrots: Carrots,
  wrap: Wrap,
  cookie: CookieMascot,
} as const;

export type MealArtKey = keyof typeof MEAL_ART;
