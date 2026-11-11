// Shared demo state, stored in localStorage so actions carry across all three concepts.
const KEY = 'pipeline-design-lab-v1';
const DEFAULT = () => ({
  classifications: {},   // personId -> 'unknown' | 'acq' | 'close'
  requests: [],          // intro / conversation requests
  karmaEvents: [],       // { who, pipeline, amount, label, ts, demo: true }
  responded: {},         // helpRequestId -> true
  goal: 'finance',
  smallNetwork: false,
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(DEFAULT(), JSON.parse(raw));
  } catch (_) { /* storage unavailable */ }
  return DEFAULT();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
}
function notify() { listeners.forEach(fn => fn(state)); }

window.addEventListener('storage', e => {
  if (e.key === KEY) { state = load(); notify(); }
});

export const getState = () => state;
export function update(fn) { fn(state); save(); notify(); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function resetDemo() { state = DEFAULT(); save(); notify(); }

export function classify(id, value) {
  update(s => { if (value) s.classifications[id] = value; else delete s.classifications[id]; });
}
export function setGoal(goal) { update(s => { s.goal = goal; }); }
export function setSmallNetwork(on) { update(s => { s.smallNetwork = on; }); }

export function addRequest({ target, path, kind, message }) {
  const req = { id: 'r' + Date.now(), target, path, kind, message, status: 'sent', ts: Date.now() };
  update(s => { s.requests.push(req); });
  return req;
}
export function requestFor(target) {
  return [...state.requests].reverse().find(r => r.target === target);
}
// Demo-only: pretend the connector / recipient responded.
export function simulateResponse(reqId, { connector, pipeline }) {
  update(s => {
    const r = s.requests.find(x => x.id === reqId);
    if (!r || r.status !== 'sent') return;
    r.status = 'introduced';
    r.resolvedTs = Date.now();
    if (connector) {
      s.karmaEvents.push({ who: connector, pipeline, amount: 15, label: 'facilitated an introduction', ts: Date.now(), demo: true });
    }
    s.karmaEvents.push({ who: r.target, pipeline, amount: 5, label: 'responded to a request', ts: Date.now(), demo: true });
  });
}
export function respondToHelp(help) {
  update(s => {
    if (s.responded[help.id]) return;
    s.responded[help.id] = true;
    s.karmaEvents.push({ who: 'jordan', pipeline: help.pipeline, amount: help.karma, label: 'answered a help request', ts: Date.now(), demo: true });
  });
}
