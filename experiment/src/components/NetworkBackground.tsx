import { useEffect, useRef, useState } from 'react';

/**
 * Tuning for the landing page's animated network. Everything visual lives
 * here: change a number, save, and the page follows.
 */
export const NETWORK = {
  /** Page background behind the network. */
  background: '#09090B',
  /** Soft white for dots and lines. */
  node: '#E8EAF0',
  line: '#E8EAF0',
  /** The few blue highlights (from the Pipeline logo's nodes). */
  accent: '#8FB5FF',

  /** Density: one node per this many square CSS pixels, clamped below. */
  areaPerNode: 8500,
  minNodes: 20,
  /** Phones (narrower than 600px) and larger screens. */
  maxNodesMobile: 35,
  maxNodesDesktop: 48,
  /** How many of the nodes are blue. */
  accentNodes: 3,

  /** Drift speed in CSS pixels per second (each node varies around this). */
  speed: 7,
  /** How quickly each node's heading wanders (radians per second). Lower = straighter paths. */
  wander: 0.25,

  /** Dot radius and opacity ranges (each node gets a random value in range). */
  nodeRadius: [0.8, 2.1] as [number, number],
  nodeOpacity: [0.15, 0.35] as [number, number],
  /** Accent dots: radius and opacity. */
  accentRadius: 2.2,
  accentOpacity: 0.55,
  /** Soft glow around dots: size multiplier and strength (0 = none). */
  glowSize: 5,
  glowStrength: 0.35,
  /** Each dot breathes slightly: how much, and how slowly (seconds per cycle). */
  twinkle: 0.25,
  twinklePeriod: 7,

  /** Lines: drawn between nodes closer than this (CSS px; scaled down on small screens). */
  linkDistance: 175,
  /** Opacity of the shortest and longest lines. */
  lineOpacity: [0.04, 0.12] as [number, number],
  lineWidth: 0.6,
  /** Gentle arc on each line (0 = straight), echoing the logo's curved connection. */
  curve: 0.12,

  /**
   * The network fades behind the invitation text: 0 = no fade, 1 = invisible
   * at the centre. Centred at (fadeX, fadeY) as fractions of the screen.
   */
  centerFade: 0.55,
  fadeX: 0.5,
  fadeY: 0.52,

  /** Slow fade-in when the page opens (ms): the network "comes alive". */
  fadeIn: 1800,
  /** Highest device-pixel ratio drawn at (sharpness vs battery). */
  maxDpr: 1.75,
};

type Node = {
  x: number; y: number; // CSS px
  a: number; // heading (radians)
  v: number; // speed (px/s)
  r: number; // radius
  o: number; // base opacity
  p: number; // twinkle phase
  accent: boolean;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const reducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function nodeCount(w: number, h: number) {
  const max = w < 600 ? NETWORK.maxNodesMobile : NETWORK.maxNodesDesktop;
  return Math.max(NETWORK.minNodes, Math.min(max, Math.round((w * h) / NETWORK.areaPerNode)));
}

function makeNodes(w: number, h: number): Node[] {
  const n = nodeCount(w, h);
  return Array.from({ length: n }, (_, i) => ({
    x: rand(0, w),
    y: rand(0, h),
    a: rand(0, Math.PI * 2),
    v: NETWORK.speed * rand(0.6, 1.4),
    r: rand(NETWORK.nodeRadius[0], NETWORK.nodeRadius[1]),
    o: rand(NETWORK.nodeOpacity[0], NETWORK.nodeOpacity[1]),
    p: rand(0, Math.PI * 2),
    accent: i < NETWORK.accentNodes,
  }));
}

/** A soft round glow, drawn once and stamped for every dot (cheaper than per-frame gradients). */
function glowSprite(color: string, dpr: number) {
  const size = Math.ceil(64 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'transparent');
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** How visible the network is at (x, y): dimmer behind the centred text, fuller at the edges and top. */
function visibility(x: number, y: number, w: number, h: number) {
  const dx = (x - w * NETWORK.fadeX) / (w * 0.55);
  const dy = (y - h * NETWORK.fadeY) / (h * 0.32);
  const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
  const smooth = d * d * (3 - 2 * d);
  const topLift = y < h * 0.3 ? 1.15 : 1; // a little more presence near the top
  return (1 - NETWORK.centerFade * (1 - smooth)) * topLift;
}

/**
 * Full-screen, slowly drifting network behind the invitation landing.
 * Canvas + requestAnimationFrame, no dependencies. Sits behind everything,
 * never takes taps, pauses when the page is hidden, draws a still frame with
 * reduced motion, and leaves a plain background if Canvas isn't available.
 */
export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      setFailed(true);
      return;
    }
    const still = reducedMotion();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let white: HTMLCanvasElement | null = null;
    let blue: HTMLCanvasElement | null = null;
    let raf = 0;
    let last = performance.now();
    const start = last;

    const resize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      if (nw === w && nh === h) return;
      dpr = Math.min(window.devicePixelRatio || 1, NETWORK.maxDpr);
      canvas.width = Math.round(nw * dpr);
      canvas.height = Math.round(nh * dpr);
      if (!nodes.length) {
        nodes = makeNodes(nw, nh);
      } else {
        // Keep the same nodes when the browser bar shows/hides: just rescale positions.
        for (const n of nodes) {
          n.x = (n.x / w) * nw;
          n.y = (n.y / h) * nh;
        }
      }
      w = nw;
      h = nh;
      white = glowSprite(NETWORK.node, dpr);
      blue = glowSprite(NETWORK.accent, dpr);
      if (still || document.visibilityState === 'hidden') draw(performance.now());
    };

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const link = Math.min(NETWORK.linkDistance, Math.max(90, w * 0.38));
      const [lo, hi] = NETWORK.lineOpacity;

      // lines first, so dots sit on top
      ctx.lineWidth = NETWORK.lineWidth;
      ctx.strokeStyle = NETWORK.line;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > link) continue;
          const t = 1 - d / link; // 1 = close
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          // closer = brighter; the last stretch before the cutoff fades out so links appear and vanish softly
          const alpha = (lo + (hi - lo) * t) * Math.min(1, t * 4) * visibility(mx, my, w, h);
          if (alpha < 0.004) continue;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          // a gentle, consistent arc (bends the same way for a given pair)
          const bend = NETWORK.curve * ((i + j) % 2 ? 1 : -1);
          ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, b.x, b.y);
          ctx.stroke();
        }
      }

      // dots with a soft glow
      const tw = (2 * Math.PI) / (NETWORK.twinklePeriod * 1000);
      for (const n of nodes) {
        const vis = visibility(n.x, n.y, w, h);
        const breathe = 1 - NETWORK.twinkle * 0.5 * (1 + Math.sin(now * tw + n.p));
        const o = (n.accent ? NETWORK.accentOpacity : n.o) * breathe * vis;
        const r = n.accent ? NETWORK.accentRadius : n.r;
        const sprite = n.accent ? blue : white;
        if (sprite && NETWORK.glowStrength > 0) {
          const g = r * NETWORK.glowSize;
          ctx.globalAlpha = o * NETWORK.glowStrength;
          ctx.drawImage(sprite, n.x - g, n.y - g, g * 2, g * 2);
        }
        ctx.globalAlpha = o;
        ctx.fillStyle = n.accent ? NETWORK.accent : NETWORK.node;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); // seconds; capped so a hiccup never jumps
      last = now;
      for (const n of nodes) {
        n.a += (Math.random() - 0.5) * 2 * NETWORK.wander * dt;
        n.x += Math.cos(n.a) * n.v * dt;
        n.y += Math.sin(n.a) * n.v * dt;
        // soft turn back at the edges (a margin lets lines run off-screen naturally)
        const m = 40;
        if (n.x < -m || n.x > w + m) n.a = Math.PI - n.a;
        if (n.y < -m || n.y > h + m) n.a = -n.a;
        n.x = Math.min(w + m, Math.max(-m, n.x));
        n.y = Math.min(h + m, Math.max(-m, n.y));
      }
      draw(now);
      canvas.style.opacity = String(Math.min(1, (now - start) / NETWORK.fadeIn));
      raf = requestAnimationFrame(step);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible' && !still) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };

    resize();
    if (still) {
      canvas.style.opacity = '1';
      draw(performance.now());
    } else {
      canvas.style.opacity = '0';
      raf = requestAnimationFrame(step);
    }
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="network-bg" aria-hidden="true" style={{ background: NETWORK.background }}>
      {failed ? <StaticNetwork /> : <canvas ref={canvasRef} className="network-canvas" />}
      {/* Darkens gently behind the invitation text for contrast. */}
      <div className="network-scrim" />
    </div>
  );
}

/** Fallback when Canvas isn't available: a few still nodes and lines near the edges. */
function StaticNetwork() {
  const pts: [number, number, number][] = [
    [8, 10, 1.4], [26, 6, 1], [44, 14, 1.6], [70, 8, 1.1], [90, 16, 1.5], [14, 30, 1], [84, 34, 1.2],
    [6, 66, 1.3], [22, 84, 1], [40, 92, 1.4], [62, 88, 1], [80, 78, 1.5], [94, 92, 1.1],
  ];
  const links: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [4, 6], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12]];
  return (
    <svg className="network-static" viewBox="0 0 100 100" preserveAspectRatio="none">
      {links.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]}
          stroke={NETWORK.line} strokeOpacity={0.08} strokeWidth={0.15} vectorEffect="non-scaling-stroke" />
      ))}
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.35} fill={i === 2 ? NETWORK.accent : NETWORK.node} fillOpacity={i === 2 ? 0.5 : 0.28} />
      ))}
    </svg>
  );
}
