"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Motion signature (docs/design-contract.md): one slow WebGL shader field,
 * concrete grain with drifting safety-orange halftone blobs. It pauses when
 * offscreen or when the tab is hidden, and draws a single still frame under
 * prefers-reduced-motion. No WebGL? The CSS concrete background shows through.
 */
const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform float u_intensity;
uniform float u_transparent;
uniform vec3 u_bg;
uniform vec3 u_dot;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float blob(vec2 uv, vec2 c, float r) {
  float d = length(uv - c);
  return r * r / (d * d + 0.0001);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res.y;
  float aspect = u_res.x / u_res.y;
  float t = u_time * 0.045;

  // Metaball field from four slow orbits.
  float f = 0.0;
  f += blob(uv, vec2(aspect * (0.78 + 0.10 * sin(t * 1.3)), 0.70 + 0.12 * cos(t * 0.9)), 0.15);
  f += blob(uv, vec2(aspect * (0.92 + 0.07 * cos(t * 0.7)), 0.25 + 0.10 * sin(t * 1.1)), 0.12);
  f += blob(uv, vec2(aspect * (0.18 + 0.08 * sin(t * 0.8 + 2.0)), 0.12 + 0.07 * cos(t * 1.4)), 0.09);
  f += blob(uv, vec2(aspect * (0.55 + 0.20 * sin(t * 0.5 + 1.0)), 1.05 + 0.05 * cos(t)), 0.10);
  f = clamp(f * u_intensity, 0.0, 1.6);

  // Halftone grid: dot radius follows the field.
  float cell = 11.0 * u_dpr;
  vec2 g = mod(frag, cell) - cell * 0.5;
  float radius = cell * 0.5 * smoothstep(0.35, 1.35, f);
  float dotMask = 1.0 - smoothstep(radius - 1.0, radius + 0.5, length(g));

  vec3 concrete = u_bg;
  vec3 orange = u_dot;
  float grain = (hash(floor(frag / u_dpr) + floor(u_time * 6.0)) - 0.5) * 0.05;
  vec3 col = mix(concrete + grain, orange, dotMask);
  // Transparent mode: only the orange dots, for dark backgrounds.
  gl_FragColor = u_transparent > 0.5 ? vec4(orange * dotMask, dotMask) : vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

export function ShaderField({
  className,
  intensity = 1,
  transparent = false,
}: {
  className?: string;
  intensity?: number;
  transparent?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Decoration never competes with the page loading: WebGL starts only once
    // the visitor has interacted AND the canvas is near the viewport (on
    // phones without a GPU a full-screen shader is expensive).
    let cleanup: (() => void) | undefined;
    let interacted = false;
    let near = false;
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    const maybeStart = () => {
      if (!interacted || !near || cleanup) return;
      cleanup = startShader(canvas, intensity, transparent) ?? (() => {});
    };
    const onInteract = () => {
      interacted = true;
      for (const e of events) window.removeEventListener(e, onInteract);
      maybeStart();
    };
    for (const e of events) window.addEventListener(e, onInteract, { passive: true, once: true });
    const gate = new IntersectionObserver(
      ([entry]) => {
        near = entry?.isIntersecting ?? false;
        maybeStart();
      },
      { rootMargin: "200px" },
    );
    gate.observe(canvas);
    return () => {
      for (const e of events) window.removeEventListener(e, onInteract);
      gate.disconnect();
      cleanup?.();
    };
  }, [intensity, transparent]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
}

function startShader(canvas: HTMLCanvasElement, intensity: number, transparent: boolean): (() => void) | undefined {
  {
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uDpr = gl.getUniformLocation(program, "u_dpr");
    const uIntensity = gl.getUniformLocation(program, "u_intensity");
    const uTransparent = gl.getUniformLocation(program, "u_transparent");
    const uBg = gl.getUniformLocation(program, "u_bg");
    const uDot = gl.getUniformLocation(program, "u_dot");
    // Colours follow the brand CSS variables (editable in /admin/settings).
    const rgb = (name: string, fallback: [number, number, number]): [number, number, number] => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : fallback;
    };
    const bg = rgb("--concrete", [0.98, 0.93, 0.92]);
    const dot = rgb("--orange", [0.96, 0.71, 0.71]);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    let raf = 0;
    let visible = true;
    const start = performance.now() - Math.random() * 60_000;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (now: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1f(uIntensity, intensity);
      gl.uniform1f(uTransparent, transparent ? 1 : 0);
      gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
      gl.uniform3f(uDot, dot[0], dot[1], dot[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    let last = 0;
    const loop = (now: number) => {
      // ~30 fps is plenty for a slow drift.
      if (now - last >= 33) {
        last = now;
        draw(now);
      }
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    resize();
    restart();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) restart();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", restart);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", restart);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }
}
