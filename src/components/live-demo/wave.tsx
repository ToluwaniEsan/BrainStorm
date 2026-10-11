"use client";

import { useEffect, useRef } from "react";

// Pastel Adobe-style colours, as RGB for canvas gradients.
const COLORS = ["159,208,255", "200,180,255", "255,159,194", "255,198,144", "166,228,255", "169,238,198"];

// The voice wave on Home: layered ribbons that swell with the mic level.
// `level` is read every frame (0..1), so it is a ref, not a prop that
// re-renders. `on` grows the wave out from the middle or folds it away.
export function Wave({ level, on }: { level: React.RefObject<number>; on: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef(on);
  useEffect(() => {
    shown.current = on;
  }, [on]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let grow = 0;
    let smooth = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = still ? 0 : now / 1000;
      grow += ((shown.current ? 1 : 0) - grow) * Math.min(1, dt * (still ? 60 : 2.2));
      smooth += (Math.min(1, (level.current ?? 0) * 2.2) - smooth) * Math.min(1, dt * 10);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (grow > 0.01) {
        const mid = h / 2;
        const span = Math.min(w, 1100) * Math.min(1, 0.25 + grow * 0.75);
        const x0 = (w - span) / 2;
        const amp = h * 0.46 * (0.3 + smooth * 1.1) * grow;
        ctx.save();
        ctx.shadowColor = "rgba(150,60,30,.28)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 4;
        [0, 1, 2, 3].forEach((li) => {
          const c = COLORS[li];
          const k = 1 - li * 0.17;
          const f = 0.9 + li * 0.45;
          const ph = li * 1.4;
          const grad = ctx.createLinearGradient(x0, 0, x0 + span, 0);
          grad.addColorStop(0, `rgba(${c},0)`);
          grad.addColorStop(0.2, `rgba(${c},.85)`);
          grad.addColorStop(0.5, `rgba(${COLORS[(li + 2) % COLORS.length]},.9)`);
          grad.addColorStop(0.8, `rgba(${c},.85)`);
          grad.addColorStop(1, `rgba(${c},0)`);
          const top: [number, number][] = [];
          const bottom: [number, number][] = [];
          for (let x = 0; x <= span; x += 4) {
            const u = x / span;
            const env = Math.pow(Math.sin(Math.PI * u), 1.6);
            const y = Math.sin(u * 7 * f + t * (1.6 + li * 0.4) + ph) * 0.6 + Math.sin(u * 13 * f - t * 2.3 + ph) * 0.4;
            top.push([x0 + x, mid - Math.abs(y) * amp * k * env - 1.5]);
            bottom.push([x0 + x, mid + Math.abs(Math.sin(u * 9 * f - t * 1.9 + ph * 1.3)) * amp * k * 0.8 * env + 1.5]);
          }
          ctx.beginPath();
          top.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          for (let j = bottom.length - 1; j >= 0; j--) ctx.lineTo(bottom[j][0], bottom[j][1]);
          ctx.closePath();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 3;
          ctx.strokeStyle = grad;
          ctx.beginPath();
          top.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        });
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  return <canvas ref={canvas} className="c-wave" aria-hidden="true" />;
}
