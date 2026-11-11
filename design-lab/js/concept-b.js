// Concept B — Discovery First
import { ME, person, pipeline, PIPELINES, OPPORTUNITIES, GOALS, recommend, pathways, inferredLink, members, search, routeIntoPipeline, relationship, first, cap } from './graph.js';
import { h, $, icon, topbar, avatar, personLine, profileView, openRequestModal, classifyDeck, guide, karmaBadge, pathwayView, fictionNote, toast } from './ui.js';
import { createGrid } from './gridview.js';
import { resultsView } from './surf.js';
import { getState, subscribe, setGoal, setSmallNetwork, requestFor, simulateResponse } from './state.js';

$('#top').replaceWith(topbar('b'));
const app = $('#app');
let exploreGrid = null;
let deck = null;
const openWhy = new Set();

function route() {
  const m = location.hash.match(/^#\/person\/(\w+)/);
  return m ? { view: 'person', id: m[1] } : { view: 'home' };
}
function render() {
  deck?.destroy(); deck = null;
  exploreGrid?.destroy(); exploreGrid = null;
  const r = route();
  if (r.view === 'person' && person[r.id]) renderExplore(r.id); else renderHome();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
subscribe(() => {
  // Re-render on state change, preserving scroll.
  const y = window.scrollY;
  if (route().view === 'home') { renderHomeLists(); }
  else render();
  window.scrollTo({ top: y });
});

// ---------- Home ----------
const hours = new Date().getHours();
const greeting = hours < 12 ? 'Good morning' : hours < 18 ? 'Good afternoon' : 'Good evening';

function renderHome() {
  deck?.destroy(); deck = null;
  const s = getState();
  const searchInput = h('input', { class: 'input', placeholder: 'Surf the Grid: people, firms, interests…', autocomplete: 'off' });
  const pop = h('div', { class: 'card search-pop hidden' });
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) { pop.classList.add('hidden'); return; }
    const res = search(q);
    pop.replaceChildren(...resultsView(res, { onPerson: id => go(id), onOpportunity: o => go(o.host), onPipeline: () => toast('Pipelines live in Concept C') }));
    pop.classList.remove('hidden');
  });
  searchInput.addEventListener('blur', () => setTimeout(() => pop.classList.add('hidden'), 200));

  app.replaceChildren(
    h('section', { class: 'hello' },
      h('div', { class: 'eyebrow' }, 'Discover'),
      h('h1', { style: 'margin-top:8px' }, `${greeting}, Jordan. `, h('em', {}, 'Here’s who can help.')),
      h('div', { class: 'controls' },
        h('span', { class: 'muted', style: 'font-size:13px' }, 'Your goal'),
        Object.entries(GOALS).map(([k, g]) => h('button', { class: `chip ${s.goal === k ? 'active' : ''}`, onClick: () => { setGoal(k); renderHome(); } }, g.label)),
        h('span', { class: 'spacer' }),
        h('label', { class: 'switch', title: 'Simulate a brand-new user with only two confirmed relationships' },
          h('input', { type: 'checkbox', checked: s.smallNetwork, onChange: e => { setSmallNetwork(e.target.checked); renderHome(); } }),
          h('span', { class: 'track' }), 'New user (small network)')),
      s.smallNetwork && h('div', { class: 'banner', html: `${icon.info}<span><b>New-user mode:</b> Jordan has only 2 confirmed relationships. Recommendations still work because they draw on shared Pipelines, interests and how willing people are to help.</span>` }),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('div', { class: 'search-wrap search-box', html: icon.search }, searchInput, pop))),
    h('div', { class: 'layout' },
      h('section', { id: 'recs' }),
      h('aside', { class: 'side', id: 'side' })),
  );
  renderHomeLists();
}

function renderHomeLists() {
  const recBox = $('#recs'), side = $('#side');
  if (!recBox) return;
  const s = getState();
  const goal = GOALS[s.goal];
  const recs = recommend(s.goal, { limit: 6 });
  recBox.replaceChildren(
    h('div', { class: 'col-title' }, h('h2', {}, 'Recommended for you'), h('span', { class: 'muted', style: 'font-size:13px' }, `${goal.label} · ranked by shared Pipelines, interests, responsiveness and path strength`)),
    ...recs.map(r => recCard(r)),
    !recs.length && h('div', { class: 'card pad muted' }, 'No one matches this goal yet.'));

  if (!deck) {
    side.replaceChildren(
      h('div', { class: 'card pad', id: 'deck-card' },
        h('div', { class: 'col-title' }, h('h2', {}, 'Sort your network'), h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Do you know them?')),
        h('div', { id: 'deck-host' })),
      h('div', { class: 'card pad', id: 'opps' }),
      h('div', { class: 'card pad', id: 'pipes' }));
    deck = classifyDeck($('#deck-host'), { compact: true });
  }
  const opps = OPPORTUNITIES.filter(o => o.tags.some(t => goal.tags.includes(t)) || o.pipelines.some(p => person[ME].pipelines.includes(p))).slice(0, 4);
  $('#opps').replaceChildren(h('div', { class: 'col-title' }, h('h2', {}, 'Opportunities in your Pipelines')),
    ...opps.map(o => h('div', { class: 'opp', onClick: () => go(o.host) },
      h('span', { class: 'date' }, o.when),
      h('div', { class: 'col', style: 'gap:2px' }, h('b', {}, o.title), h('span', { class: 'muted', style: 'font-size:12.5px' }, `${o.org} · hosted by ${person[o.host].name}`)))));

  const others = PIPELINES.filter(p => !person[ME].pipelines.includes(p.id)).map(p => ({
    p, relevant: members(p.id).filter(m => m.interests.some(t => goal.tags.includes(t))), route: routeIntoPipeline(p.id),
  })).filter(x => x.relevant.length).sort((a, b) => b.relevant.length - a.relevant.length);
  $('#pipes').replaceChildren(h('div', { class: 'col-title' }, h('h2', {}, 'Communities worth exploring')),
    ...others.map(({ p, relevant, route: rt }) => h('div', { class: 'pipe-row' },
      h('span', { class: 'pipe-dot', style: `background:${p.color}` }, p.short[0]),
      h('div', { class: 'col', style: 'gap:1px;flex:1' }, h('b', {}, p.name),
        h('span', { class: 'muted', style: 'font-size:12.5px' }, `${relevant.length} people in ${goal.label.toLowerCase()}${rt ? ` · reachable via ${first(person[rt.nodes[1]].name)}` : ''}`)),
      rt && h('button', { class: 'btn sm', onClick: () => go(rt.nodes[rt.nodes.length - 1]) }, 'Way in'))));
}

const REASON_ICON = { interest: '◎', pipeline: '◉', help: '★', path: '→' };
function recCard(r) {
  const p = person[r.id];
  const inf = inferredLink(r.id);
  const via = r.path
    ? h('div', { class: 'via' }, h('span', { class: 'mini' }, r.path.nodes.map(id => avatar(id, 'sm'))),
      h('span', {}, r.path.hops === 2 ? `Via ${person[r.path.nodes[1]].name}: ${r.path.steps[0].context.toLowerCase()}` : `${r.path.hops} confirmed steps away`),
      h('span', { class: 'spacer' }), h('span', { class: 'tag ok' }, 'Confirmed path'))
    : h('div', { class: 'via' }, h('span', { class: 'rel inferred' }, h('i'), `Inferred only · both in ${inf.map(x => x.short).join(', ')}`),
      h('span', { class: 'spacer' }), h('span', { class: 'muted', style: 'font-size:12px' }, 'No mutual connection yet'));
  const req = requestFor(r.id);
  const why = openWhy.has(r.id);
  const b = r.breakdown;
  const rows = [['Shared interests', b.interest, 30], ['Shared Pipelines', b.affiliation, 36], ['Willing to help', b.helpfulness, 20], ['Path strength', b.proximity, 24], ['Alumni', b.alumni, 6]];
  return h('article', { class: 'card rec' },
    avatar(r.id, 'lg'),
    h('div', { class: 'col', style: 'gap:2px;min-width:0' }, h('h3', {}, p.name), h('span', { class: 'muted' }, personLine(r.id))),
    h('div', { class: 'score' }, h('b', {}, r.score), h('span', {}, 'Match')),
    h('div', { class: 'reasons' }, r.reasons.filter(x => x.kind !== 'path').slice(0, 4).map(x =>
      h('span', { class: `tag ${x.kind === 'pipeline' ? 'pipe shared' : x.kind === 'help' ? 'signal' : ''}` },
        x.kind === 'pipeline' ? h('span', { class: 'dot', style: `background:${Object.values(pipeline).find(pp => pp.name === x.label)?.color}` }) : `${REASON_ICON[x.kind]} `, x.label))),
    via,
    why && h('div', { class: 'breakdown' }, rows.map(([l, v, max]) => [h('span', { class: 'muted' }, l), h('span', { class: 'bar' }, h('i', { style: `width:${(v / max) * 100}%` })), h('span', { class: 'mono' }, '+' + v)])),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', html: `${icon.route}<span>Explore connection</span>`, onClick: () => go(r.id) }),
      req ? h('button', { class: 'btn', onClick: () => openRequestModal(r.id) }, req.status === 'sent' ? 'Request pending' : 'Introduced · demo')
        : h('button', { class: 'btn', onClick: () => openRequestModal(r.id) }, r.path ? 'Request intro' : 'Reach out'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost sm', onClick: () => { openWhy.has(r.id) ? openWhy.delete(r.id) : openWhy.add(r.id); renderHomeLists(); } }, why ? 'Hide score' : 'Why this score?')));
}

function go(id) { location.hash = `#/person/${id}`; }

// ---------- Explore connection ----------
function renderExplore(id) {
  const p = person[id];
  const paths = pathways(id, 3);
  const inf = inferredLink(id);
  const rel = relationship(id);

  // Left-to-right path layout: you on the left, them on the right, one lane per pathway.
  const lanes = [-120, 120, -235];
  const pos = { [ME]: { x: -260, y: 0 }, [id]: { x: 260, y: 0 } };
  const ids = new Set([ME, id]);
  paths.forEach((pt, i) => pt.nodes.forEach((n, j) => {
    ids.add(n);
    if (pos[n]) return;
    const t = j / (pt.nodes.length - 1);
    pos[n] = { x: -260 + t * 520, y: lanes[i] ?? (i * 90) };
  }));

  const canvas = h('div', { class: 'canvas' });
  const gridCol = h('div', { class: 'explore-grid' },
    h('div', { class: 'row', style: 'margin-bottom:10px' }, h('h2', { style: 'font-size:16px' }, 'Explore connection'),
      h('span', { class: 'muted', style: 'font-size:13px' }, `${paths.length} confirmed ${paths.length === 1 ? 'route' : 'routes'}${inf.length ? ' · 1 inferred affiliation' : ''}`)),
    canvas,
    h('div', { class: 'caption legend', style: 'flex-direction:row' },
      h('span', { class: 'rel close' }, h('i'), 'Close'), h('span', { class: 'rel acq' }, h('i'), 'Acquaintance'),
      h('span', { class: 'rel inferred' }, h('i'), 'Shared affiliation (inferred)'),
      h('span', { class: 'rel', style: 'color:var(--signal-ink)' }, h('i', { style: 'border-color:var(--signal);border-top-width:3px' }), 'Selected route')),
    growthCard(id));

  const left = h('div', {},
    h('div', { class: 'card profile-card' }, profileView(id, {
      onShowPath: pt => exploreGrid?.highlight({ path: pt.nodes, selected: id, inferredTo: id }),
      onRequest: tid => openRequestModal(tid),
    })));

  app.replaceChildren(
    h('a', { href: '#/', class: 'btn ghost sm', html: `${icon.back}<span>Recommendations</span>` }),
    h('div', { class: 'explore' }, left, gridCol));

  exploreGrid = createGrid(canvas, {
    nodes: [...ids], clusters: [], positions: pos, labelZoom: 0, fitPad: 170,
    onSelect: n => { if (n !== ME && n !== id) go(n); },
  });
  exploreGrid.highlight({ paths: paths.map(x => x.nodes), selected: id, inferredTo: rel.type === 'potential' ? id : undefined });
}

function growthCard(id) {
  const req = requestFor(id);
  if (!req || req.status !== 'introduced') return null;
  const c = req.path.length > 2 ? person[req.path[1]] : null;
  return h('div', { class: 'card grow' }, h('span', { class: 'tag ok', html: icon.check }),
    h('div', { class: 'col', style: 'gap:2px;flex:1' },
      h('b', {}, 'Your network got stronger'),
      h('span', { class: 'muted', style: 'font-size:13px' }, `${first(person[id].name)} is now an acquaintance${c ? `; ${c.name} earned +15 karma for the introduction` : ''}.`)),
    h('span', { class: 'tag demo' }, 'Simulated'));
}

render();

guide('b', [
  { title: 'Recommendations, explained', text: 'The homepage answers one question: who can help with your goal? Every card says why, from shared Pipelines and interests to responsiveness and path strength.', run: () => { location.hash = '#/'; } , runLabel: 'Go home' },
  { title: 'See the score', text: 'Scoring is transparent and deterministic. Open “Why this score?” on the top card to see the breakdown.', run: () => { location.hash = '#/'; const top = recommend(getState().goal, { limit: 1 })[0]; if (top) { openWhy.add(top.id); renderHomeLists(); } } },
  { title: 'Change your goal', text: 'Switch to Startups & venture and the ranking updates instantly. Same network, different question.', run: () => { location.hash = '#/'; setGoal('startups'); renderHome(); } },
  { title: 'Explore a connection', text: 'Back on private equity, open Marcus Hale. The Grid appears only now, to show the three confirmed routes and the inferred shared affiliation.', run: () => { setGoal('finance'); go('marcus'); } },
  { title: 'Request an introduction', text: 'Pick the route through Coach Whitaker and send the pre-written note. You can then simulate a response, clearly labeled as a demo.', run: () => { if (route().id !== 'marcus') go('marcus'); setTimeout(() => openRequestModal('marcus'), 50); } },
  { title: 'Sort your network', text: 'Back home, the swipe deck turns “shared affiliation” into real relationships. Drag right for acquaintance, left for don’t know, or press and hold for close.', run: () => { location.hash = '#/'; setTimeout(() => $('#deck-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); } },
  { title: 'Useful with a small network', text: 'Turn on “New user”. With only 2 confirmed relationships, Pipeline still recommends Marcus, through Mateo, or through the shared Pipeline when no path exists.', run: () => { location.hash = '#/'; setSmallNetwork(true); renderHome(); } },
]);
document.body.append(h('div', { style: 'position:fixed;right:16px;bottom:14px;z-index:6' }, fictionNote()));
