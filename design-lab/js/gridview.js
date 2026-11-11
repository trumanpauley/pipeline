// Interactive Grid renderer: SVG, deterministic force layout, pan / zoom / select, path highlighting.
import { ME, PEOPLE, person, pipeline, graph, members } from './graph.js';
import { personColor } from './ui.js';
import { initials, first } from './graph.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
const ekey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const DEFAULT_ORDER = ['baseball', 'eng', 'startups', 'lakeside', 'crestline', 'finance'];

export function computeLayout(ids, clusters, { radius = 330, centerMe = true, seed = 7 } = {}) {
  const rand = rng(seed);
  const centers = {};
  clusters.forEach((pid, i) => {
    const a = -Math.PI / 2 + (i / clusters.length) * Math.PI * 2;
    centers[pid] = { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
  const idx = new Map(ids.map((id, i) => [id, i]));
  const N = ids.map(id => {
    const ps = person[id].pipelines.filter(p => centers[p]);
    // Primary Pipeline pulls hardest; secondary memberships pull gently toward overlaps.
    let wx = 0, wy = 0, ws = 0;
    ps.forEach((p, i) => { const w = i === 0 ? 1 : 0.2; wx += centers[p].x * w; wy += centers[p].y * w; ws += w; });
    const t = ps.length ? { x: wx / ws, y: wy / ws } : { x: 0, y: 0 };
    if (!ps.length && clusters.length) { t.x *= 0.3; t.y *= 0.3; }
    return { id, tx: t.x, ty: t.y, x: t.x + (rand() - .5) * 80, y: t.y + (rand() - .5) * 80, vx: 0, vy: 0, pin: centerMe && id === ME };
  });
  N.forEach(n => { if (n.pin) { n.x = 0; n.y = 0; } });
  const links = graph().edges.filter(e => idx.has(e.a) && idx.has(e.b)).map(e => [idx.get(e.a), idx.get(e.b)]);
  for (let it = 0; it < 420; it++) {
    const alpha = 1 - it / 420;
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const a = N[i], b = N[j];
      let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = rand() - .5; dy = rand() - .5; d2 = 1; }
      const d = Math.sqrt(d2);
      let f = 2200 / d2;
      if (d < 46) f += (46 - d) * 0.5;
      const fx = dx / d * f, fy = dy / d * f;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
    for (const [i, j] of links) {
      const a = N[i], b = N[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - 80) * 0.007;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const n of N) {
      n.vx += (n.tx - n.x) * 0.07; n.vy += (n.ty - n.y) * 0.07;
      if (n.pin) { n.vx = n.vy = 0; continue; }
      n.x += n.vx * 0.5 * (0.3 + alpha); n.y += n.vy * 0.5 * (0.3 + alpha);
      n.vx *= 0.55; n.vy *= 0.55;
    }
  }
  return Object.fromEntries(N.map(n => [n.id, { x: n.x, y: n.y }]));
}

function convexHull(points) {
  const P = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function createGrid(host, opts = {}) {
  const ids = opts.nodes || PEOPLE.map(p => p.id);
  const idSet = new Set(ids);
  const clusters = (opts.clusters || DEFAULT_ORDER).filter(pid => ids.filter(id => person[id].pipelines.includes(pid)).length >= (opts.minCluster || 2));
  const pos = opts.positions || computeLayout(ids, clusters, opts.layout);
  const insets = opts.insets || (() => ({ top: 0, right: 0, bottom: 0, left: 0 }));

  host.classList.add('grid-host');
  const root = s('svg', { role: 'img', 'aria-label': 'Interactive network graph' });
  const vp = s('g');
  const gH = s('g'), gE = s('g'), gO = s('g'), gN = s('g');
  vp.append(gH, gE, gO, gN);
  root.append(vp);
  host.append(root);

  const controls = document.createElement('div');
  controls.className = 'grid-controls';
  controls.innerHTML = `<button class="btn" data-z="in" aria-label="Zoom in">+</button><button class="btn" data-z="out" aria-label="Zoom out">−</button><button class="btn" data-z="fit" aria-label="Fit" title="Fit to screen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>`;
  if (opts.controls !== false) host.append(controls);
  controls.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const z = b.dataset.z;
    if (z === 'fit') return fit();
    const r = root.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, z === 'in' ? 1.35 : 1 / 1.35, true);
  });

  // ----- Hulls -----
  const hullEls = {};
  function drawHulls() {
    gH.replaceChildren();
    for (const pid of clusters) {
      // Territory = people whose primary Pipeline this is; overlaps show up as edges and on focus.
      const primary = id => person[id].pipelines.find(p => clusters.includes(p));
      let ms = ids.filter(id => id !== ME && primary(id) === pid);
      if (ms.length < 2) ms = ids.filter(id => person[id].pipelines.includes(pid) && id !== ME);
      if (!ms.length) continue;
      const pts = ms.map(id => pos[id]);
      const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
      const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
      const r = Math.max(...pts.map(q => Math.hypot(q.x - cx, q.y - cy))) + 30;
      const hull = convexHull(pts);
      const p = pipeline[pid];
      const g = s('g', { class: 'g-hull', 'data-pid': pid });
      const d = hull.length >= 3 ? 'M' + hull.map(q => `${q.x},${q.y}`).join('L') + 'Z'
        : hull.length === 2 ? `M${hull[0].x},${hull[0].y}L${hull[1].x},${hull[1].y}` : `M${cx},${cy}l0.1,0`;
      g.append(s('path', { class: 'pad', d, fill: p.color, 'fill-opacity': .07, stroke: p.color, 'stroke-opacity': .07, 'stroke-width': 58, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      g.append(s('path', { class: 'edge', d, fill: 'none', stroke: p.color, 'stroke-opacity': .0, 'stroke-width': 1 }));
      const top = Math.min(...pts.map(q => q.y));
      const t = s('text', { x: cx, y: top - 36, 'text-anchor': 'middle', fill: p.color });
      t.textContent = p.name;
      g.append(t);
      gH.append(g);
      hullEls[pid] = { g, cx, cy, r };
    }
  }

  // ----- Edges -----
  const edgeEls = new Map();
  let drawn = new Set();
  function drawEdges(animateNew = false) {
    const next = new Map();
    for (const e of graph().edges) {
      if (!idSet.has(e.a) || !idSet.has(e.b)) continue;
      const k = ekey(e.a, e.b);
      let el = edgeEls.get(k);
      if (!el) {
        el = s('line', { x1: pos[e.a].x, y1: pos[e.a].y, x2: pos[e.b].x, y2: pos[e.b].y });
        if (animateNew && !drawn.has(k)) { el.classList.add('new'); setTimeout(() => el.classList.remove('new'), 2600); }
        gE.append(el);
      }
      el.setAttribute('class', `g-edge ${e.strength} ${e.a === ME || e.b === ME ? 'mine' : ''} ${el.classList.contains('new') ? 'new' : ''}`);
      next.set(k, el);
    }
    for (const [k, el] of edgeEls) if (!next.has(k)) el.remove();
    edgeEls.clear(); next.forEach((v, k) => edgeEls.set(k, v));
    drawn = new Set(next.keys());
  }

  // ----- Nodes -----
  const nodeEls = {};
  function drawNodes() {
    gN.replaceChildren();
    for (const id of ids) {
      const p = person[id];
      const r = id === ME ? 20 : 14;
      const g = s('g', { class: `g-node ${id === ME ? 'me' : ''}`, transform: `translate(${pos[id].x},${pos[id].y})`, 'data-id': id, tabindex: 0, role: 'button', 'aria-label': p.name });
      g.append(s('circle', { class: 'ring', r: r + 5 }));
      g.append(s('circle', { class: 'body', r, stroke: id === ME ? '#15171C' : personColor(p) }));
      const ini = s('text', { class: 'ini' }); ini.textContent = id === ME ? 'You' : initials(p.name);
      const nm = s('text', { class: 'name', y: r + 15 }); nm.textContent = id === ME ? 'Jordan (you)' : p.name;
      g.append(ini, nm);
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter') opts.onSelect?.(id); });
      gN.append(g);
      nodeEls[id] = g;
    }
    refreshRelClasses();
  }
  function refreshRelClasses() {
    const { adj } = graph();
    const mine = new Map((adj.get(ME) || []).map(e => [e.to, e.strength]));
    for (const id of ids) nodeEls[id]?.classList.toggle('mine-close', mine.get(id) === 'close');
  }

  // ----- View transform -----
  let view = { x: 0, y: 0, k: 1 };
  function apply() {
    vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    root.classList.toggle('labels-on', view.k >= (opts.labelZoom ?? 1.65));
  }
  let anim = null;
  function animateTo(target, ms = 520) {
    cancelAnimationFrame(anim);
    const from = { ...view }; const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function fit(list = ids, { pad = opts.fitPad || 70, maxK = 1.8, animate = true } = {}) {
    const r = root.getBoundingClientRect();
    if (!r.width) return;
    const ins = insets();
    const W = r.width - ins.left - ins.right, H = r.height - ins.top - ins.bottom;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of list) { const p = pos[id]; if (!p) continue; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (list === ids) for (const pid in hullEls) { const hh = hullEls[pid]; minX = Math.min(minX, hh.cx - hh.r); maxX = Math.max(maxX, hh.cx + hh.r); minY = Math.min(minY, hh.cy - hh.r - 20); maxY = Math.max(maxY, hh.cy + hh.r); }
    const bw = Math.max(80, maxX - minX), bh = Math.max(80, maxY - minY);
    const k = Math.min(maxK, (W - pad) / bw, (H - pad) / bh);
    const t = { k, x: ins.left + W / 2 - (minX + bw / 2) * k, y: ins.top + H / 2 - (minY + bh / 2) * k };
    animate ? animateTo(t) : (view = t, apply());
  }
  function zoomAt(sx, sy, factor, animate = false) {
    const k = Math.max(0.3, Math.min(3.2, view.k * factor));
    const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    const t = { k, x: sx - wx * k, y: sy - wy * k };
    animate ? animateTo(t, 260) : (view = t, apply());
  }

  // ----- Pointer: pan / select -----
  let drag = null;
  const pointers = new Map();
  if (opts.interactive !== false) {
  root.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture(e.pointerId);
    drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target, pinch: null };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = root.getBoundingClientRect();
      const f = (Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch.d) * drag.pinch.k / view.k;
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, f);
      drag.moved = true; return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; root.classList.add('dragging'); cancelAnimationFrame(anim); }
    if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
  });
  const up = e => {
    pointers.delete(e.pointerId);
    if (!drag) return;
    root.classList.remove('dragging');
    if (!drag.moved) {
      const node = drag.target.closest?.('.g-node');
      const hull = drag.target.closest?.('.g-hull');
      if (node) opts.onSelect?.(node.dataset.id);
      else if (hull) opts.onCluster?.(hull.dataset.pid);
      else opts.onBackground?.();
    }
    if (!pointers.size) drag = null;
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  }

  // ----- Highlighting -----
  function clearHighlight() {
    root.classList.remove('dim');
    gO.replaceChildren();
    for (const el of edgeEls.values()) el.classList.remove('path', 'lit');
    for (const id in nodeEls) nodeEls[id].classList.remove('on-path', 'lit', 'match', 'selected', 'show-label');
    for (const pid in hullEls) hullEls[pid].g.classList.remove('faded', 'focus');
  }
  function overlayLine(a, b, cls) {
    gO.append(s('line', { class: `g-edge ${cls}`, x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y }));
  }
  function highlight({ path, paths, selected, matches, lit, focusCluster, inferredTo } = {}) {
    clearHighlight();
    const any = path || paths || selected || matches || lit || focusCluster;
    if (!any) return;
    root.classList.add('dim');
    (paths || (path ? [path] : [])).forEach(nodes => {
      nodes.forEach(id => nodeEls[id]?.classList.add('on-path'));
      for (let i = 0; i < nodes.length - 1; i++) {
        const el = edgeEls.get(ekey(nodes[i], nodes[i + 1]));
        if (el) el.classList.add('path'); else if (pos[nodes[i]] && pos[nodes[i + 1]]) overlayLine(nodes[i], nodes[i + 1], 'path inferred');
      }
    });
    if (selected && nodeEls[selected]) {
      nodeEls[selected].classList.add('selected');
      if (!path && !paths) for (const e of graph().adj.get(selected)) {
        if (!nodeEls[e.to]) continue;
        nodeEls[e.to].classList.add('lit', 'show-label');
        edgeEls.get(ekey(selected, e.to))?.classList.add('lit');
      }
    }
    if (inferredTo && pos[inferredTo] && !edgeEls.has(ekey(ME, inferredTo))) overlayLine(ME, inferredTo, 'inferred');
    (matches || []).forEach(id => nodeEls[id]?.classList.add('match', 'show-label'));
    (lit || []).forEach(id => nodeEls[id]?.classList.add('lit', 'show-label'));
    if (focusCluster) {
      for (const pid in hullEls) hullEls[pid].g.classList.toggle('faded', pid !== focusCluster);
      hullEls[focusCluster]?.g.classList.add('focus');
      members(focusCluster).forEach(p => nodeEls[p.id]?.classList.add('lit'));
    }
  }

  drawHulls(); drawEdges(); drawNodes();
  requestAnimationFrame(() => fit(ids, { animate: false }));
  const ro = new ResizeObserver(() => { if (!host._fitted) { fit(ids, { animate: false }); host._fitted = true; } });
  ro.observe(host);

  return {
    pos, clusters,
    fit, highlight, clearHighlight,
    zoomToNode(id, k = 1.7) {
      const r = root.getBoundingClientRect(); const ins = insets();
      const W = r.width - ins.left - ins.right, H = r.height - ins.top - ins.bottom;
      animateTo({ k, x: ins.left + W / 2 - pos[id].x * k, y: ins.top + H / 2 - pos[id].y * k });
    },
    zoomToCluster(pid) { fit(ids.filter(id => person[id].pipelines.includes(pid)), { pad: 120, maxK: 2 }); },
    refresh() { drawEdges(true); refreshRelClasses(); },
    destroy() { ro.disconnect(); host.replaceChildren(); },
    nodeEl: id => nodeEls[id],
  };
}

export { first };
