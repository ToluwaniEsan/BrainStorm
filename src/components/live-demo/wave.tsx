"use client";

import { useEffect, useRef } from "react";

// How long the bubbles take to gather in the middle before the wave appears
// (matches the .lava-lamp transition in clutter.css).
const GATHER_MS = 1400;

// The voice wave on Home: a few plain sine lines, in the ink colour, running
// across the middle of the screen with soft, tapered ends. They swell with
// the mic level. `level` is read every frame (0..1), so it is a ref, not a
// prop that re-renders. `on` eases the wave in (after the bubbles gather) or
// lets it settle flat and fade. `compact` shrinks it as it rides to the top;
// the canvas keeps its size and the wave eases smaller inside it, so the move
// never forces a resize.
export function Wave({ level, on, compact }: { level: React.RefObject<number>; on: boolean; compact: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef(on);
  const since = useRef(0);
  const small = useRef(compact);
  useEffect(() => {
    shown.current = on;
    since.current = performance.now();
  }, [on]);
  useEffect(() => {
    small.current = compact;
  }, [compact]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ink = getComputedStyle(el).color || "rgb(74,42,31)";
    let raf = 0;
    let grow = 0;
    let smooth = 0;
    let phase = 0;
    let size = small.current ? 0.6 : 1;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Ease in only once the bubbles have gathered; ease out straight away.
      const target = shown.current && now - since.current > (still ? 0 : GATHER_MS) ? 1 : 0;
      grow += (target - grow) * Math.min(1, dt * (still ? 60 : 1.6));
      smooth += (Math.min(1, (level.current ?? 0) * 2.2) - smooth) * Math.min(1, dt * 4);
      if (!still) phase += dt * (1.2 + smooth * 1.6);
      // Same 1.8 s ease as the stage's move to the top.
      size += ((small.current ? 0.6 : 1) - size) * Math.min(1, dt * (still ? 60 : 2.4));

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (grow > 0.005) {
        const eased = grow * grow * (3 - 2 * grow);
        const mid = h / 2;
        // Not edge to edge: about two thirds of the screen, wider as it eases in.
        const span = Math.min(w * 0.72, 900) * (0.35 + eased * 0.65);
        const x0 = (w - span) / 2;
        const amp = h * 0.36 * size * (0.18 + smooth * 0.82) * eased;
        ctx.strokeStyle = ink;
        ctx.lineCap = "round";
        // Main line plus two fainter echoes, like a classic voice wave.
        const lines = [
          { k: 1, f: 2.2, off: 0, a: 0.85, wdt: 2.4 },
          { k: 0.6, f: 2.2, off: 0.9, a: 0.35, wdt: 1.6 },
          { k: 0.35, f: 2.2, off: 1.8, a: 0.2, wdt: 1.2 },
        ];
        for (const l of lines) {
          ctx.globalAlpha = l.a * eased;
          ctx.lineWidth = l.wdt;
          ctx.beginPath();
          for (let x = 0; x <= span; x += 3) {
            const u = x / span;
            // Fades to a flat line at both ends.
            const env = Math.pow(Math.sin(Math.PI * u), 2);
            const y = mid + Math.sin(u * Math.PI * 2 * l.f - phase - l.off) * amp * l.k * env;
            if (x === 0) ctx.moveTo(x0 + x, y);
            else ctx.lineTo(x0 + x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  return <canvas ref={canvas} className="c-wave" aria-hidden="true" />;
}
