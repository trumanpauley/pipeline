// Shared UI components for all three concepts.
import {
  ME, person, pipeline, pathways, inferredLink, relationship, sharedPipelines, personKarma, helpLabel,
  potentialConnections, hopsFrom, degreeLabel, first, initials, cap,
} from './graph.js';
import { getState, subscribe, addRequest, requestFor, simulateResponse, classify, resetDemo } from './state.js';

// ---------- DOM helper ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  fit: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
  karma: svg('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6L12 16.4 6.6 19.4l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor" stroke="none"/>', 14),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  route: svg('<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5"/>'),
  grid: svg('<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="m7 7 3.2 3.5M17 8.3l-3.3 2.4M7.6 16.7l2.6-3M16.3 16.6l-2.6-3"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  play: svg('<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>', 14),
  layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  send: svg('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
};

export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="7" cy="16" r="4" fill="#15171C"/><circle cx="25" cy="8" r="3.2" fill="none" stroke="#15171C" stroke-width="2"/>
  <circle cx="25" cy="24" r="3.2" fill="none" stroke="#15171C" stroke-width="2"/>
  <path d="M11 16h4c3 0 3-8 6.5-8M15 16c3 0 3 8 6.5 8" fill="none" stroke="#E39A2D" stroke-width="2.4" stroke-linecap="round"/></svg>`;

// ---------- Primitives ----------
export function personColor(p) {
  const pid = p.pipelines.find(x => x !== 'harvard') || p.pipelines[0];
  return pipeline[pid].color;
}
export function avatar(id, size = '') {
  const p = person[id];
  return h('span', { class: `avatar ${size} ${id === ME ? 'me' : ''}`, style: `--c:${personColor(p)}`, title: p.name }, initials(p.name));
}
export function pipelineTag(pid, { shared = false } = {}) {
  const p = pipeline[pid];
  return h('span', { class: `tag pipe ${shared ? 'shared' : ''}` }, h('span', { class: 'dot', style: `background:${p.color}` }), p.name);
}
export function karmaBadge(n, extra = '') {
  return h('span', { class: `karma ${extra}`, html: icon.karma }, String(n));
}
const REL_LABEL = { close: 'Close connection', acq: 'Acquaintance', potential: 'Potential connection', unknown: 'Marked: don’t know', none: 'Outside your Pipelines', me: 'You' };
export function relBadge(id) {
  const r = relationship(id);
  const label = REL_LABEL[r.type] + (r.source === 'self' ? ' · self-reported' : r.source === 'intro' ? ' · via intro (demo)' : '');
  return h('span', { class: `rel ${r.type}` }, h('i'), label);
}
export function personLine(id) {
  const p = person[id];
  return `${p.title} · ${p.org}${p.classYear && p.role !== 'staff' ? ` · ’${String(p.classYear).slice(2)}` : ''}`;
}
export function demoTag(text = 'Demo') { return h('span', { class: 'tag demo' }, text); }

// ---------- Toasts ----------
let toastHost;
export function toast(html, ms = 3200) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast', html });
  toastHost.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Modal ----------
export function modal({ title, subtitle, body, foot, onClose }) {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = h('div', { class: 'modal-foot' }, foot);
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' },
      h('div', { class: 'col', style: 'gap:4px;flex:1' }, h('h3', { style: 'font-size:18px' }, title), subtitle && h('p', { class: 'muted' }, subtitle)),
      h('button', { class: 'btn ghost icon', html: icon.x, 'aria-label': 'Close', onClick: close })),
    bodyEl, footEl);
  const scrim = h('div', { class: 'scrim', onMousedown: e => { if (e.target === scrim) close(); } }, box);
  document.body.append(scrim);
  document.addEventListener('keydown', esc);
  return { close, bodyEl, footEl, setBody(...c) { bodyEl.replaceChildren(...c); }, setFoot(...c) { footEl.replaceChildren(...c); } };
}

// ---------- Top bar ----------
export function topbar(active) {
  const links = [['a', 'A', 'Grid First'], ['b', 'B', 'Discovery First'], ['c', 'C', 'Pipeline First']];
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: 'index.html', html: `${BRAND_MARK}<span>Pipeline</span><small>Design Lab</small>` }),
    h('nav', { class: 'concept-switch' }, links.map(([k, L, name]) =>
      h('a', { href: `concept-${k}.html`, class: active === k ? 'active' : '' }, `${L}`, h('span', { class: 'long' }, ` · ${name}`)))),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn ghost sm', title: 'Clear swipes, requests and karma from this demo', html: `${icon.undo}<span>Reset demo</span>`,
      onClick: () => { if (confirm('Reset all demo actions (classifications, requests, karma)?')) { resetDemo(); toast('Demo data reset'); } },
    }),
    h('div', { class: 'me-chip' }, avatar(ME, 'sm'), h('span', { class: 'name' }, 'Jordan Ellis'), h('span', { class: 'tag' }, 'Fictional')));
}

// ---------- Pathways ----------
export function pathwayView(path, { index = 0, selectable = false, selected = false, onClick } = {}) {
  const chain = h('div', { class: 'chain' });
  path.nodes.forEach((id, i) => {
    if (i > 0) {
      const st = path.steps[i - 1];
      chain.append(h('div', { class: `link ${st.strength} ${st.source === 'self' ? 'self' : ''}` }, h('i'),
        h('small', {}, st.strength === 'close' ? 'Close' : 'Acquaintance')));
    }
    chain.append(h('div', { class: 'node' }, avatar(id, 'sm'), h('span', {}, id === ME ? 'You' : first(person[id].name))));
  });
  const label = index === 0 ? 'Strongest path' : `Alternative ${index}`;
  const connector = path.nodes.length > 2 ? person[path.nodes[1]] : null;
  return h('div', { class: `pathway ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`, onClick },
    h('div', { class: 'head' },
      h('strong', {}, label),
      h('span', { class: 'muted' }, `${path.hops} ${path.hops === 1 ? 'step' : 'steps'}`),
      h('span', { class: 'spacer' }),
      h('span', { class: 'tag ok', html: `${icon.check}<span>Confirmed relationships</span>` })),
    chain,
    connector && h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' },
      `Via ${connector.name}: ${path.steps[0].context}. Then: ${path.steps[1].context}.`));
}

export function inferredView(target) {
  const shared = inferredLink(target);
  if (!shared.length) return null;
  const chain = h('div', { class: 'chain' },
    h('div', { class: 'node' }, avatar(ME, 'sm'), h('span', {}, 'You')),
    h('div', { class: 'link inferred' }, h('i'), h('small', {}, shared.map(p => p.short).join(' · '))),
    h('div', { class: 'node' }, avatar(target, 'sm'), h('span', {}, first(person[target].name))));
  return h('div', { class: 'pathway' },
    h('div', { class: 'head' }, h('strong', {}, 'Shared affiliation'), h('span', { class: 'spacer' }),
      h('span', { class: 'rel inferred' }, h('i'), 'Inferred — not a relationship')),
    chain,
    h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' },
      `You’re both in ${shared.map(p => p.name).join(' and ')}. That’s a reason to reach out, not evidence you know each other.`));
}

// ---------- Profile ----------
export function profileView(id, { onShowPath, onRequest, showPaths = true } = {}) {
  const p = person[id];
  const rel = relationship(id);
  const hops = hopsFrom(ME).get(id);
  const paths = id === ME ? [] : pathways(id, 3);
  const mine = new Set(person[ME].pipelines);
  const root = h('div', { class: 'profile' });

  root.append(h('div', { class: 'profile-head' }, avatar(id, 'lg'),
    h('div', { class: 'col', style: 'gap:3px' },
      h('h2', {}, p.name),
      h('p', { class: 'muted' }, personLine(id)),
      h('div', { class: 'row', style: 'gap:10px;margin-top:2px' }, relBadge(id),
        id !== ME && h('span', { class: 'faint' }, '·'), id !== ME && h('span', { class: 'muted', style: 'font-size:12px' }, degreeLabel(hops))))));

  root.append(h('p', { style: 'margin-bottom:14px;color:var(--ink-2)' }, p.bio));

  if (id !== ME) {
    const req = requestFor(id);
    const actions = h('div', { class: 'row', style: 'gap:8px;margin-bottom:16px;flex-wrap:wrap' });
    if (rel.type === 'close' || rel.type === 'acq') {
      actions.append(h('button', { class: 'btn primary', html: `${icon.send}<span>Request a conversation</span>`, onClick: () => onRequest?.(id) }));
    } else if (req && req.status === 'sent') {
      actions.append(h('button', { class: 'btn', onClick: () => onRequest?.(id) }, 'Request pending — view status'));
    } else {
      actions.append(h('button', { class: 'btn primary', html: `${icon.send}<span>${paths.length ? 'Request an introduction' : 'Reach out'}</span>`, onClick: () => onRequest?.(id) }));
    }
    if (paths.length && onShowPath) actions.append(h('button', { class: 'btn', html: `${icon.route}<span>Show in Grid</span>`, onClick: () => onShowPath(paths[0]) }));
    root.append(actions);
    if (req) root.append(requestStatus(req));
  }

  if (showPaths && id !== ME) {
    const sec = h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'How you’re connected'));
    const list = h('div', { class: 'col', style: 'gap:10px' });
    paths.forEach((path, i) => list.append(pathwayView(path, {
      index: i, selectable: !!onShowPath, onClick: () => onShowPath?.(path),
    })));
    const inf = inferredView(id);
    if (inf) list.append(inf);
    if (!paths.length && !inf) list.append(h('p', { class: 'muted' }, 'No confirmed path or shared Pipeline yet.'));
    sec.append(list);
    root.append(sec);
  }

  root.append(h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'Pipelines'),
    h('div', { class: 'wrap' }, p.pipelines.map(pid => pipelineTag(pid, { shared: id !== ME && mine.has(pid) })))));
  root.append(h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'Interests'),
    h('div', { class: 'wrap' }, p.interests.map(t => h('span', { class: 'tag' }, cap(t))))));
  root.append(h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'Helping others'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Karma'), h('dd', {}, karmaBadge(personKarma(id))),
      h('dt', {}, 'Responsiveness'), h('dd', {}, helpLabel(p.helpfulness)),
      h('dt', {}, 'Open to'), h('dd', {}, p.openTo.length ? p.openTo.map(cap).join(', ') : 'Not listed'),
      p.note && h('dt', {}, 'Baseball'), p.note && h('dd', {}, p.note),
      h('dt', {}, 'Location'), h('dd', {}, p.location))));
  return root;
}

// ---------- Requests ----------
function karmaPipelineFor(connector, target) {
  const mine = person[ME].pipelines;
  const a = connector ? sharedPipelines(connector, target).filter(x => mine.includes(x)) : sharedPipelines(ME, target);
  const order = ['baseball', 'lakeside', 'finance', 'crestline', 'eng', 'startups', 'harvard'];
  return a.sort((x, y) => order.indexOf(x) - order.indexOf(y))[0] || (connector ? person[connector].pipelines[0] : person[target].pipelines[0]);
}

export function requestStatus(req, { onSimulated } = {}) {
  const target = person[req.target];
  const connector = req.path && req.path.length > 2 ? person[req.path[1]] : null;
  const steps = [
    ['Request sent', true],
    [connector ? `${first(connector.name)} reviews and forwards` : `${first(target.name)} responds`, req.status !== 'sent'],
    [connector ? `Introduced to ${first(target.name)}` : 'Conversation scheduled', req.status !== 'sent'],
  ];
  const box = h('div', { class: 'status-box' },
    h('div', { class: 'row' }, h('strong', {}, req.status === 'sent' ? 'Waiting for a response' : 'Introduction made'),
      h('span', { class: 'spacer' }), req.status !== 'sent' && demoTag('Simulated')),
    h('div', { class: 'col', style: 'gap:4px' }, steps.map(([t, done]) =>
      h('div', { class: 'row', style: `font-size:13px;color:${done ? 'var(--ink)' : 'var(--muted)'}` },
        h('span', { style: `width:16px;height:16px;border-radius:50%;display:grid;place-items:center;${done ? 'background:var(--ok);color:#fff' : 'border:1.5px solid var(--line-2)'}`, html: done ? svg('<path d="m5 12 5 5 9-10"/>', 10) : '' }), t))));
  if (req.status === 'sent') {
    box.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', {
        class: 'btn sm', onClick: () => {
          const pid = karmaPipelineFor(connector?.id, target.id);
          simulateResponse(req.id, { connector: connector?.id, pipeline: pid });
          toast(connector
            ? `<span>${connector.name} introduced you to ${first(target.name)}</span><span class="k">+15 karma · ${pipeline[pid].short}</span>`
            : `<span>${target.name} accepted</span><span class="k">+5 karma</span>`, 4200);
          onSimulated?.(req);
        },
      }, 'Simulate a response'), demoTag('Demo only — nothing is sent')));
  } else {
    box.append(h('p', { class: 'muted', style: 'font-size:12.5px' },
      `Your Grid now shows a new acquaintance edge to ${first(target.name)}${connector ? `, and ${first(connector.name)} earned karma for helping` : ''}. In the real product, both people would confirm the relationship.`));
  }
  return box;
}

export function openRequestModal(targetId, { preferredPath, onChange } = {}) {
  const t = person[targetId];
  const rel = relationship(targetId);
  const existing = requestFor(targetId);
  const direct = rel.type === 'close' || rel.type === 'acq';
  const paths = direct ? [] : pathways(targetId, 3);
  const shared = inferredLink(targetId);
  const options = paths.map((p, i) => ({ kind: 'intro', path: p, i }));
  if (direct || shared.length || !paths.length) options.push({ kind: 'direct', path: { nodes: [ME, targetId] } });
  let choice = options.findIndex(o => preferredPath && o.path.nodes.join() === preferredPath.nodes.join());
  if (choice < 0) choice = 0;
  const goal = 'I’m a sophomore on Harvard Baseball exploring private equity and investment banking';

  const msgFor = o => o.kind === 'intro'
    ? `Hi ${first(person[o.path.nodes[1]].name)} — ${goal}. I noticed ${t.name} is a ${t.title} at ${t.org}. Would you be comfortable introducing us? I’m happy to send a short note you can forward.`
    : `Hi ${first(t.name)} — ${goal}. ${shared.length ? `I saw we’re both part of ${shared[0].name}. ` : ''}Would you have 15 minutes in the next few weeks for a quick conversation about your path to ${t.org}?`;

  const m = modal({
    title: direct ? `Request a conversation with ${first(t.name)}` : `Request an introduction to ${first(t.name)}`,
    subtitle: personLine(targetId),
    body: [], foot: [], onClose: () => onChange?.(),
  });

  function showStatus(req) {
    m.setBody(requestStatus(req, { onSimulated: () => showStatus(requestFor(targetId)) }));
    m.setFoot(h('span', { class: 'disclaimer', html: `${icon.info}<span>Prototype — no messages leave this page.</span>` }), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onClick: m.close }, 'Done'));
    onChange?.();
  }
  if (existing) { showStatus(existing); return m; }

  const ta = h('textarea', { class: 'input', rows: 5 });
  const list = h('div', { class: 'col', style: 'gap:8px' });
  const render = () => {
    list.replaceChildren(...options.map((o, i) => {
      const sel = i === choice;
      const pick = () => { choice = i; ta.value = msgFor(options[choice]); render(); };
      if (o.kind === 'intro') {
        const v = pathwayView(o.path, { index: o.i, selectable: true, selected: sel, onClick: pick });
        return v;
      }
      return h('div', { class: `pathway selectable ${sel ? 'selected' : ''}`, onClick: pick },
        h('div', { class: 'head', style: 'margin:0' }, h('strong', {}, direct ? 'Message directly' : 'Reach out directly'),
          h('span', { class: 'spacer' }),
          direct ? relBadge(targetId) : h('span', { class: 'rel inferred' }, h('i'), shared.length ? `Inferred · ${shared.map(s => s.short).join(', ')}` : 'No shared Pipeline')),
        !direct && h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:6px' }, 'Cold outreach. Warm introductions get answered far more often.'));
    }));
  };
  render();
  ta.value = msgFor(options[choice]);
  m.setBody(
    h('div', { class: 'eyebrow' }, direct ? 'Route' : 'Choose a pathway'), list,
    h('div', { class: 'eyebrow' }, 'Message'), ta);
  m.setFoot(h('span', { class: 'disclaimer', html: `${icon.info}<span>Prototype — nothing is sent.</span>` }), h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onClick: m.close }, 'Cancel'),
    h('button', {
      class: 'btn primary', html: `${icon.send}<span>Send request</span>`, onClick: () => {
        const o = options[choice];
        const req = addRequest({ target: targetId, path: o.path.nodes, kind: o.kind, message: ta.value });
        toast(o.kind === 'intro' ? `Request sent to ${person[o.path.nodes[1]].name}` : `Request sent to ${t.name}`);
        showStatus(req);
      },
    }));
  return m;
}

// ---------- Relationship classification deck ----------
export function classifyDeck(host, { onClassified, compact = false } = {}) {
  let last = null;
  const root = h('div', {});
  host.append(root);

  function render() {
    const queue = potentialConnections();
    const deck = h('div', { class: 'deck', tabindex: 0, style: compact ? 'height:300px' : '' });
    const counter = h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('span', { class: 'muted', style: 'font-size:12.5px' }, queue.length ? `${queue.length} people share a Pipeline with you` : 'All sorted'),
      h('span', { class: 'spacer' }),
      last && h('button', { class: 'btn ghost sm', html: `${icon.undo}<span>Undo</span>`, onClick: () => { classify(last, null); last = null; } }));
    if (!queue.length) {
      deck.append(h('div', { class: 'deck-empty' }, h('div', { class: 'col', style: 'align-items:center' },
        h('strong', { style: 'color:var(--ink)' }, 'You’ve sorted everyone in your Pipelines'),
        h('span', {}, 'Use Reset demo in the top bar to start again.'))));
      root.replaceChildren(counter, deck);
      return;
    }
    if (queue[1]) deck.append(card(queue[1], true));
    const top = card(queue[0], false);
    deck.append(top);
    wire(top, queue[0].id);

    const act = (v) => fling(top, queue[0].id, v);
    const actions = h('div', { class: 'deck-actions' },
      h('button', { class: 'btn', title: 'Left arrow', onClick: () => act('unknown') }, '← Don’t know'),
      h('button', { class: 'btn', title: 'Right arrow', onClick: () => act('acq') }, 'Acquaintance →'),
      h('button', { class: 'btn signal', title: 'Press C', onClick: () => act('close') }, 'Close connection'));
    deck.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') act('unknown');
      if (e.key === 'ArrowRight') act('acq');
      if (e.key.toLowerCase() === 'c') act('close');
    });
    root.replaceChildren(counter, deck, actions,
      h('p', { class: 'muted', style: 'text-align:center;font-size:12px;margin-top:10px' },
        'Swipe left: don’t know · right: acquaintance · press and hold: close. Private to you.'));
  }

  function card(p, behind) {
    const shared = sharedPipelines(ME, p.id);
    return h('div', { class: `deck-card ${behind ? 'behind' : ''}` },
      h('span', { class: 'stamp left' }, 'Don’t know'),
      h('span', { class: 'stamp right' }, 'Acquaintance'),
      h('span', { class: 'stamp hold' }, 'Close'),
      h('div', { class: 'row', style: 'gap:14px' }, avatar(p.id, 'lg'),
        h('div', { class: 'col', style: 'gap:2px' }, h('h3', { style: 'font-size:19px' }, p.name), h('span', { class: 'muted' }, personLine(p.id)))),
      h('p', { style: 'color:var(--ink-2)' }, p.bio),
      h('div', { class: 'col', style: 'gap:6px;margin-top:auto' },
        h('span', { class: 'eyebrow' }, 'Why you’re seeing them'),
        h('div', { class: 'wrap' }, shared.map(pid => pipelineTag(pid, { shared: true }))),
        h('span', { class: 'rel potential', style: 'margin-top:4px' }, h('i'), 'Shared affiliation only — do you actually know them?')),
      h('div', { class: 'hold-meter' }));
  }

  function fling(el, id, value) {
    const dx = value === 'unknown' ? -700 : value === 'acq' ? 700 : 0;
    el.style.transform = value === 'close' ? 'scale(1.04)' : `translate(${dx}px, 40px) rotate(${dx / 30}deg)`;
    el.style.opacity = '0';
    const stamp = el.querySelector(value === 'unknown' ? '.stamp.left' : value === 'acq' ? '.stamp.right' : '.stamp.hold');
    if (stamp) stamp.style.opacity = '1';
    setTimeout(() => {
      last = id;
      classify(id, value);
      const n = first(person[id].name);
      toast(value === 'unknown' ? `Hid ${n} from suggestions` : value === 'acq' ? `${n} marked as an acquaintance` : `${n} marked as a close connection`);
      onClassified?.(id, value);
    }, 260);
  }

  function wire(el, id) {
    let sx = 0, sy = 0, dx = 0, down = false, held = false, timer = null;
    const meter = el.querySelector('.hold-meter');
    const stamps = { l: el.querySelector('.stamp.left'), r: el.querySelector('.stamp.right'), c: el.querySelector('.stamp.hold') };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = true; held = false; sx = e.clientX; sy = e.clientY; dx = 0;
      el.setPointerCapture(e.pointerId); el.classList.add('dragging');
      meter.style.transition = 'transform .7s linear'; meter.style.transform = 'scaleX(1)';
      timer = setTimeout(() => { held = true; stamps.c.style.opacity = '1'; }, 700);
    });
    el.addEventListener('pointermove', e => {
      if (!down) return;
      dx = e.clientX - sx; const dy = e.clientY - sy;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { clearTimeout(timer); meter.style.transition = 'none'; meter.style.transform = 'scaleX(0)'; }
      if (held) return;
      el.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 22}deg)`;
      stamps.l.style.opacity = Math.max(0, Math.min(1, -dx / 100));
      stamps.r.style.opacity = Math.max(0, Math.min(1, dx / 100));
    });
    const end = () => {
      if (!down) return;
      down = false; clearTimeout(timer); el.classList.remove('dragging');
      meter.style.transition = 'transform .2s'; meter.style.transform = 'scaleX(0)';
      if (held) return fling(el, id, 'close');
      if (dx > 110) return fling(el, id, 'acq');
      if (dx < -110) return fling(el, id, 'unknown');
      el.style.transform = ''; stamps.l.style.opacity = 0; stamps.r.style.opacity = 0; stamps.c.style.opacity = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  render();
  const unsub = subscribe(render);
  return { destroy() { unsub(); root.remove(); } };
}

// ---------- Guided demo ----------
export function guide(key, steps) {
  const store = 'guide-' + key;
  let i = 0; let open = true;
  try { const v = JSON.parse(sessionStorage.getItem(store) || '{}'); i = v.i || 0; open = v.open !== false; } catch (_) { }
  const el = h('div', { class: 'guide' });
  document.body.append(el);
  const save = () => { try { sessionStorage.setItem(store, JSON.stringify({ i, open })); } catch (_) { } };
  function render() {
    save();
    if (!open) {
      el.className = 'guide collapsed';
      el.replaceChildren(h('button', { class: 'btn guide-open', html: `${icon.play}<span>Guided demo · ~75s</span>`, onClick: () => { open = true; render(); } }));
      return;
    }
    el.className = 'guide';
    const s = steps[i];
    el.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'step-n' }, `Guided demo · ${i + 1} of ${steps.length}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm icon', html: icon.x, 'aria-label': 'Hide guide', onClick: () => { open = false; render(); } })),
      h('h4', {}, s.title),
      h('p', {}, s.text),
      h('div', { class: 'bar' }, h('i', { style: `width:${((i + 1) / steps.length) * 100}%` })),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', disabled: i === 0, onClick: () => { i--; render(); } }, 'Back'),
        h('span', { class: 'spacer' }),
        s.run && h('button', { class: 'btn sm signal', onClick: () => s.run() }, s.runLabel || 'Show me'),
        i < steps.length - 1
          ? h('button', { class: 'btn sm light', onClick: () => { i++; render(); steps[i].onEnter?.(); } }, 'Next')
          : h('button', { class: 'btn sm light', onClick: () => { i = 0; open = false; render(); } }, 'Finish')));
  }
  render();
  return { go(n) { i = n; open = true; render(); } };
}

export function fictionNote() {
  return h('span', { class: 'disclaimer', html: `${icon.info}<span>All people, firms and relationships are fictional.</span>` });
}
