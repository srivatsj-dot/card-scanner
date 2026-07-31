import { useEffect, useRef } from "react";

/**
 * A short burst of confetti over the whole screen, for when a genuinely special
 * card lands in the binder. Draws on a canvas and removes itself when finished,
 * so it costs nothing the rest of the time. Purely decorative: it sits behind
 * pointer events and is hidden from screen readers.
 */
export default function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) { onDone(); return; }

    // Respect a reduced-motion preference — no animation, just get out of the way.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { onDone(); return; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const COLORS = ["#f4c45a", "#5b8cff", "#3ad29f", "#ff6b6b", "#7b5cff", "#ffffff"];
    const pieces = Array.from({ length: 130 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 11 - 4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf = 0;
    const started = performance.now();
    const DURATION = 2600;

    const frame = (now: number) => {
      const elapsed = now - started;
      ctx.clearRect(0, 0, W, H);
      for (const p of pieces) {
        p.vy += 0.28;          // gravity
        p.vx *= 0.995;         // drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Fade out over the last third so it doesn't just vanish.
        ctx.globalAlpha = Math.max(0, Math.min(1, (DURATION - elapsed) / (DURATION * 0.35)));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < DURATION) raf = requestAnimationFrame(frame);
      else onDone();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}
