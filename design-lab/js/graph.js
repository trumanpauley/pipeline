// Graph engine: relationships, pathfinding (Dijkstra / BFS), search and recommendations.
// Deterministic — no AI or external services.
import { ME, PEOPLE, PIPELINES, EDGES, OPPORTUNITIES, GOALS, SYNONYMS } from './data.js';
import { getState } from './state.js';

export const person = Object.fromEntries(PEOPLE.map(p => [p.id, p]));
export const pipeline = Object.fromEntries(PIPELINES.map(p => [p.id, p]));
export { ME, PEOPLE, PIPELINES, OPPORTUNITIES, GOALS };

const COST = { close: 1, acq: 2 };
// How strongly a shared Pipeline signals relevance (smaller, tighter communities count more)
const PIPELINE_WEIGHT = { baseball: 20, lakeside: 12, finance: 10, crestline: 8, eng: 6, startups: 6, harvard: 3 };
const SMALL_NETWORK_KEEP = new Set(['mateo', 'olivia']);

let cache = null;
function key(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

// Build the effective relationship graph from base data + the user's demo actions.
export function graph() {
  const s = getState();
  const sig = JSON.stringify([s.classifications, s.requests.map(r => r.id + r.status), s.smallNetwork]);
  if (cache && cache.sig === sig) return cache;

  const edges = new Map();
  for (const [a, b, strength, context] of EDGES) {
    if (s.smallNetwork && (a === ME || b === ME) && !SMALL_NETWORK_KEEP.has(a === ME ? b : a)) continue;
    edges.set(key(a, b), { a, b, strength, context, source: 'confirmed' });
  }
  for (const [id, value] of Object.entries(s.classifications)) {
    if (value === 'acq' || value === 'close') {
      edges.set(key(ME, id), { a: ME, b: id, strength: value, context: 'You marked this relationship', source: 'self' });
    }
  }
  for (const r of s.requests) {
    if (r.status === 'introduced' && !edges.has(key(ME, r.target))) {
      edges.set(key(ME, r.target), { a: ME, b: r.target, strength: 'acq', context: 'Introduced through Pipeline (demo)', source: 'intro' });
    }
  }
  const adj = new Map(PEOPLE.map(p => [p.id, []]));
  for (const e of edges.values()) {
    adj.get(e.a).push({ to: e.b, ...e });
    adj.get(e.b).push({ to: e.a, ...e });
  }
  cache = { sig, edges: [...edges.values()], adj };
  return cache;
}

export function edgeBetween(a, b) {
  return graph().adj.get(a)?.find(e => e.to === b) || null;
}

export function sharedPipelines(a, b) {
  const pb = new Set(person[b].pipelines);
  return person[a].pipelines.filter(p => pb.has(p));
}

// Relationship of the user to someone: close | acq | potential | none
export function relationship(id) {
  if (id === ME) return { type: 'me' };
  const e = edgeBetween(ME, id);
  if (e) return { type: e.strength, source: e.source, context: e.context };
  const shared = sharedPipelines(ME, id);
  if (getState().classifications[id] === 'unknown') return { type: 'unknown', shared };
  if (shared.length) return { type: 'potential', shared };
  return { type: 'none', shared };
}

// Single-source Dijkstra over confirmed relationships.
export function dijkstra(from, banned = new Set()) {
  const { adj } = graph();
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  while (true) {
    let u = null, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; u = id; }
    if (u === null) break;
    done.add(u);
    for (const e of adj.get(u)) {
      if (banned.has(e.to)) continue;
      const nd = best + COST[e.strength];
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  return { dist, prev };
}

function reconstruct(prev, from, to) {
  const nodes = [to];
  while (nodes[0] !== from) {
    const p = prev.get(nodes[0]);
    if (!p) return null;
    nodes.unshift(p);
  }
  return nodes;
}

export function describePath(nodes) {
  const steps = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = edgeBetween(nodes[i], nodes[i + 1]);
    steps.push({ from: nodes[i], to: nodes[i + 1], strength: e.strength, context: e.context, source: e.source });
  }
  const cost = steps.reduce((s, x) => s + COST[x.strength], 0);
  return { nodes, steps, cost, hops: steps.length, kind: 'confirmed' };
}

// Up to k node-disjoint introduction pathways from the user to a target, best first.
export function pathways(target, k = 3, from = ME) {
  const out = [];
  const banned = new Set();
  for (let i = 0; i < k; i++) {
    const { prev } = dijkstra(from, banned);
    const nodes = reconstruct(prev, from, target);
    if (!nodes) break;
    const p = describePath(nodes);
    if (out.some(o => o.nodes.join() === p.nodes.join())) break;
    out.push(p);
    if (nodes.length <= 2) break; // direct connection: nothing to route around
    nodes.slice(1, -1).forEach(n => banned.add(n));
  }
  return out;
}

// Inferred link: shared affiliations only, no confirmed relationship implied.
export function inferredLink(target, from = ME) {
  return sharedPipelines(from, target).map(pid => pipeline[pid]);
}

// BFS hop counts over confirmed relationships.
export function hopsFrom(from = ME) {
  const { adj } = graph();
  const hops = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const u = q.shift();
    for (const e of adj.get(u)) if (!hops.has(e.to)) { hops.set(e.to, hops.get(u) + 1); q.push(e.to); }
  }
  return hops;
}

export function degreeLabel(h) {
  if (h === 0) return 'You';
  if (h === 1) return '1st';
  if (h === 2) return '2nd';
  if (h === 3) return '3rd';
  if (h == null) return 'Not yet reachable';
  return h + 'th';
}

export function members(pid) { return PEOPLE.filter(p => p.pipelines.includes(pid)); }
export function myPipelines() { return person[ME].pipelines.map(id => pipeline[id]); }

export function myConnectionsIn(pid) {
  return members(pid).filter(p => p.id !== ME && edgeBetween(ME, p.id));
}

// Members of pid that also belong to other Pipelines, grouped by the other Pipeline.
export function bridges(pid) {
  const out = [];
  for (const q of PIPELINES) {
    if (q.id === pid) continue;
    const shared = members(pid).filter(p => p.pipelines.includes(q.id) && p.id !== ME);
    if (shared.length) out.push({ pipeline: q, people: shared });
  }
  return out.sort((a, b) => b.people.length - a.people.length);
}

// Shortest confirmed route from the user into another Pipeline.
export function routeIntoPipeline(pid) {
  const { dist, prev } = dijkstra(ME);
  let best = null;
  for (const m of members(pid)) {
    if (m.id === ME || !dist.has(m.id)) continue;
    const d = dist.get(m.id);
    if (!best || d < best.d) best = { id: m.id, d };
  }
  if (!best) return null;
  return describePath(reconstruct(prev, ME, best.id));
}

// Pathway between two Pipelines: bridge members + the shortest route from any A member to any B member.
export function pipelineBridge(a, b) {
  const both = members(a).filter(p => p.pipelines.includes(b) && p.id !== ME);
  return { both, route: routeIntoPipeline(b) };
}

// Karma
export function personKarma(id) {
  return person[id].karma + getState().karmaEvents.filter(e => e.who === id).reduce((s, e) => s + e.amount, 0);
}
export function pipelineKarma(pid) {
  return pipeline[pid].karma + getState().karmaEvents.filter(e => e.pipeline === pid).reduce((s, e) => s + e.amount, 0);
}
export function helpLabel(h) {
  if (h >= 0.9) return 'Very responsive';
  if (h >= 0.75) return 'Usually responds';
  if (h >= 0.55) return 'Sometimes responds';
  return 'Rarely responds';
}

// ---------- Recommendations ----------
export function recommend(goalKey = getState().goal, { limit = 8, includeConnected = false } = {}) {
  const goal = GOALS[goalKey];
  const { dist } = dijkstra(ME);
  const out = [];
  for (const p of PEOPLE) {
    if (p.id === ME) continue;
    const rel = relationship(p.id);
    if (!includeConnected && (rel.type === 'close' || rel.type === 'acq' || rel.type === 'unknown')) continue;

    const reasons = [];
    let interest = 0;
    goal.tags.forEach((tag, i) => {
      if (p.interests.includes(tag)) {
        const pts = i === 0 ? 30 : i === 1 ? 16 : 8;
        if (pts > interest) interest = pts;
        reasons.push({ kind: 'interest', label: cap(tag), pts });
      }
    });
    if (!interest) continue;

    const shared = sharedPipelines(ME, p.id);
    const affil = Math.min(36, shared.reduce((s, id) => s + PIPELINE_WEIGHT[id], 0));
    shared.sort((x, y) => PIPELINE_WEIGHT[y] - PIPELINE_WEIGHT[x]).forEach(id =>
      reasons.push({ kind: 'pipeline', label: pipeline[id].name, pts: PIPELINE_WEIGHT[id] }));

    const help = Math.round(p.helpfulness * 20);
    if (p.helpfulness >= 0.75) reasons.push({ kind: 'help', label: helpLabel(p.helpfulness), pts: help });

    const d = dist.get(p.id);
    const proximity = d == null ? 0 : Math.max(0, 24 - 4 * d);
    let path = null;
    if (d != null) {
      path = pathways(p.id, 1)[0];
      reasons.push({ kind: 'path', label: path.hops === 2 ? `Via ${first(person[path.nodes[1]].name)}` : `${path.hops} hops away`, pts: proximity });
    }
    const alum = p.role === 'alum' ? 6 : 0;
    const score = Math.min(99, interest + affil + help + proximity + alum);
    out.push({ id: p.id, score, reasons, path, breakdown: { interest, affiliation: affil, helpfulness: help, proximity, alumni: alum } });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

// People who share a Pipeline with the user but have no confirmed relationship yet.
export function potentialConnections() {
  const cls = getState().classifications;
  return PEOPLE.filter(p => p.id !== ME && !edgeBetween(ME, p.id) && !cls[p.id] && sharedPipelines(ME, p.id).length)
    .map(p => ({ p, w: sharedPipelines(ME, p.id).reduce((s, id) => s + PIPELINE_WEIGHT[id], 0) }))
    .sort((a, b) => b.w - a.w || a.p.name.localeCompare(b.p.name))
    .map(x => x.p);
}

// ---------- Surf the Grid search ----------
const STOP = new Set(['in', 'at', 'the', 'and', 'of', 'who', 'people', 'person', 'for', 'with', 'work', 'works', 'working', 'a', 'an', 'to', 'into', 'me', 'my', 'from', 'on']);

function personFields(p) {
  const roleWords = { alum: 'alum alumni graduate', student: 'student current player', staff: 'staff coach faculty', other: '' }[p.role];
  const roleName = { alum: `Alumni${p.classYear ? ' ’' + String(p.classYear).slice(2) : ''}`, student: 'Current student', staff: 'Staff', other: '' }[p.role];
  return [
    { label: 'Name', text: p.name, w: 5 },
    { label: 'Company', text: p.org, w: 4 },
    { label: 'Interest', text: p.interests.join(' · '), w: 4, list: p.interests },
    { label: 'Role', text: p.title, w: 3 },
    { label: 'Status', text: roleWords, w: 3, list: [roleName] },
    { label: 'Pipeline', text: p.pipelines.map(id => pipeline[id].name).join(' · '), w: 3, list: p.pipelines.map(id => pipeline[id].name) },
    { label: 'Location', text: p.location, w: 2 },
    { label: 'About', text: p.bio, w: 1 },
  ];
}

export function parseQuery(q) {
  const raw = q.toLowerCase().replace(/[^a-z0-9&'\- ]/g, ' ').split(/\s+/).filter(Boolean);
  const terms = [];
  for (let i = 0; i < raw.length; i++) {
    const two = raw[i] + ' ' + (raw[i + 1] || '');
    if (['private equity', 'investment banking', 'venture capital', 'sports business', 'machine learning', 'data science'].includes(two)) {
      terms.push(two); i++; continue;
    }
    if (STOP.has(raw[i])) continue;
    terms.push(SYNONYMS[raw[i]] || raw[i]);
  }
  return terms;
}

function matchTerm(term, fields) {
  let best = null;
  for (const f of fields) {
    const hay = f.text.toLowerCase();
    if (hay.includes(term) || (term.length > 4 && hay.includes(term.slice(0, -1)))) {
      if (!best || f.w > best.w) {
        const hit = f.list ? (f.list.length === 1 ? f.list[0] : f.list.find(x => x.toLowerCase().includes(term.slice(0, -1))) || f.text) : f.text;
        best = { w: f.w, label: f.label, value: hit };
      }
    }
  }
  return best;
}

export function search(q, { scope = 'grid', degree = 'any', openOnly = false } = {}) {
  const terms = parseQuery(q);
  const hops = hopsFrom(ME);
  const pool = PEOPLE.filter(p => p.id !== ME && (scope === 'grid' || p.pipelines.includes(scope)));
  const people = [];
  for (const p of pool) {
    const h = hops.get(p.id);
    if (degree === '1' && h !== 1) continue;
    if (degree === '2' && !(h === 1 || h === 2)) continue;
    if (openOnly && !p.openTo.length) continue;
    const fields = personFields(p);
    let text = 0; const matched = [];
    let ok = true;
    for (const t of terms) {
      const m = matchTerm(t, fields);
      if (!m) { ok = false; break; }
      text += m.w;
      if (!matched.some(x => x.label === m.label && x.value === m.value)) matched.push(m);
    }
    if (!ok) continue;
    const prox = h == null ? 0 : Math.max(0, 4 - h);
    const score = text * 10 + prox * 3 + p.helpfulness * 4;
    people.push({ id: p.id, score, matched, hops: h });
  }
  people.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const opps = !terms.length ? [] : OPPORTUNITIES.filter(o => (scope === 'grid' || o.pipelines.includes(scope)) &&
    terms.every(t => (o.title + ' ' + o.org + ' ' + o.tags.join(' ')).toLowerCase().includes(t)));
  const pips = !terms.length || scope !== 'grid' ? [] : PIPELINES.filter(p =>
    terms.every(t => (p.name + ' ' + p.description).toLowerCase().includes(t)));
  return { terms, people, opportunities: opps, pipelines: pips };
}

export function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function first(name) { return name.split(' ')[0]; }
export function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
