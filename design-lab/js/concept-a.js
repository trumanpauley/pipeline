// Concept A — Grid First
import { ME, person, pipeline, PIPELINES, search, pathways, relationship, members, myConnectionsIn, bridges, pipelineBridge, pipelineKarma, myPipelines, first } from './graph.js';
import { h, $, icon, topbar, profileView, openRequestModal, avatar, pathwayView, karmaBadge, guide, toast, personLine, fictionNote } from './ui.js';
import { createGrid } from './gridview.js';
import { resultsView, SUGGESTED_QUERIES } from './surf.js';
import { subscribe, requestFor, simulateResponse } from './state.js';

$('#top').replaceWith(topbar('a'));

const isWide = () => window.innerWidth > 860;
const drawer = $('#drawer');
const surf = $('#surf');
let drawerState = null; // { kind: 'person'|'pipeline', id, path }
const history = [];

const grid = createGrid($('#grid'), {
  insets: () => isWide()
    ? { top: 0, left: 400, right: drawer.classList.contains('open') ? 420 : 0, bottom: 0 }
    : { top: Math.min(surf.offsetHeight + 20, window.innerHeight * 0.5), left: 0, right: 0, bottom: 0 },
  onSelect: id => openPerson(id),
  onCluster: pid => openPipeline(pid),
  onBackground: () => { if (!ui.query && ui.mode === 'people') { closeDrawer(); grid.clearHighlight(); } },
});

// ---------- Legend ----------
$('#legend').append(
  h('div', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Legend'),
  h('span', { class: 'rel close' }, h('i'), 'Close connection'),
  h('span', { class: 'rel acq' }, h('i'), 'Acquaintance'),
  h('span', { class: 'rel inferred' }, h('i'), 'Shared affiliation (inferred)'),
  h('span', { class: 'rel', style: 'color:var(--signal-ink)' }, h('i', { style: 'border-color:var(--signal);border-top-width:3px' }), 'Introduction path'),
);

// ---------- Surf the Grid panel ----------
const ui = { query: '', scope: 'grid', mode: 'people', from: 'baseball', to: 'crestline', active: null };

function renderSurf() {
  const head = h('div', { class: 'surf-head' });
  head.append(h('div', { class: 'row' },
    h('h1', { html: `${icon.grid}<span>Surf the Grid</span>` }), h('span', { class: 'spacer' }),
    h('div', { class: 'seg' },
      h('button', { class: ui.mode === 'people' ? 'active' : '', onClick: () => setMode('people') }, 'Search'),
      h('button', { class: ui.mode === 'bridge' ? 'active' : '', onClick: () => setMode('bridge') }, 'Between Pipelines'))));

  const results = h('div', { class: 'results', id: 'results' });
  if (ui.mode === 'people') {
    const input = h('input', { class: 'input', id: 'q', placeholder: 'People, companies, interests…', value: ui.query, autocomplete: 'off' });
    input.addEventListener('input', () => { ui.query = input.value; runSearch(); });
    head.append(h('div', { class: 'search-box', html: icon.search }, input));
    const scopes = [['grid', 'Entire Grid'], ...myPipelines().map(p => [p.id, p.short]),
      ...PIPELINES.filter(p => !person[ME].pipelines.includes(p.id)).map(p => [p.id, p.short])];
    head.append(h('div', { class: 'scopes' }, scopes.map(([id, label]) => h('button', {
      class: `chip ${ui.scope === id ? 'active' : ''}`, onClick: () => { ui.scope = id; renderSurf(); runSearch(); if (id !== 'grid') grid.zoomToCluster(id); else grid.fit(); },
    }, id !== 'grid' && h('span', { class: 'dot', style: `background:${pipeline[id].color}` }), label))));
    surf.replaceChildren(head, results);
    if (!ui.query) {
      surf.append(h('div', { class: 'suggest' }, h('span', { class: 'muted', style: 'font-size:12px;width:100%' }, 'Try:'),
        SUGGESTED_QUERIES.map(q => h('button', { class: 'chip', onClick: () => setQuery(q) }, q))));
    }
    runSearch();
  } else {
    const opt = sel => PIPELINES.map(p => h('option', { value: p.id, selected: p.id === sel }, p.name));
    const fromSel = h('select', { class: 'input', onChange: e => { ui.from = e.target.value; renderSurf(); } }, opt(ui.from));
    const toSel = h('select', { class: 'input', onChange: e => { ui.to = e.target.value; renderSurf(); } }, opt(ui.to));
    head.append(h('div', { class: 'bridge-form' }, fromSel, h('span', { class: 'muted', html: icon.arrow }), toSel));
    surf.replaceChildren(head, results);
    renderBridge(results);
  }
}

function runSearch() {
  const box = $('#results');
  if (!box || ui.mode !== 'people') return;
  if (!ui.query.trim()) {
    box.replaceChildren();
    surf.querySelector('.suggest')?.classList.remove('hidden');
    if (!drawerState) grid.highlight(ui.scope === 'grid' ? {} : { focusCluster: ui.scope });
    return;
  }
  surf.querySelector('.suggest')?.classList.add('hidden');
  const res = search(ui.query, { scope: ui.scope });
  box.replaceChildren(...resultsView(res, {
    activeId: drawerState?.id,
    onPerson: id => openPerson(id, { zoom: true }),
    onHover: id => { if (!drawerState) grid.highlight({ matches: res.people.map(r => r.id), selected: id || undefined }); },
    onPipeline: pid => openPipeline(pid),
    onOpportunity: o => openPerson(o.host, { zoom: true }),
  }));
  if (!drawerState) grid.highlight({ matches: res.people.map(r => r.id), focusCluster: ui.scope !== 'grid' ? ui.scope : undefined });
}

function renderBridge(box) {
  const a = pipeline[ui.from], b = pipeline[ui.to];
  if (a.id === b.id) { box.replaceChildren(h('p', { class: 'muted', style: 'padding:14px' }, 'Pick two different Pipelines.')); return; }
  const { both, route } = pipelineBridge(a.id, b.id);
  const items = [h('div', { class: 'group-label' }, `Bridges · in both ${a.short} and ${b.short}`)];
  if (both.length) both.forEach(p => items.push(h('div', { class: 'res', onClick: () => openPerson(p.id, { zoom: true }) },
    avatar(p.id, 'sm'), h('div', { class: 'meta' }, h('b', {}, p.name), h('p', {}, personLine(p.id))))));
  else items.push(h('p', { class: 'muted', style: 'padding:6px 10px 10px;font-size:13px' }, 'No one belongs to both. Look for a route through people instead.'));
  items.push(h('div', { class: 'group-label' }, `Your shortest route into ${b.short}`));
  if (route) items.push(h('div', { style: 'padding:4px 6px 8px' }, pathwayView(route, { selectable: true, onClick: () => grid.highlight({ path: route.nodes, matches: both.map(p => p.id) }) })));
  else items.push(h('p', { class: 'muted', style: 'padding:6px 10px' }, 'No confirmed route yet.'));
  box.replaceChildren(...items);
  closeDrawer();
  grid.highlight({ path: route?.nodes, matches: both.map(p => p.id), lit: members(b.id).map(p => p.id) });
  grid.fit([...members(a.id), ...members(b.id)].map(p => p.id), { pad: 100 });
}

function setMode(m) { ui.mode = m; renderSurf(); if (m === 'people') { grid.clearHighlight(); grid.fit(); } }
function setQuery(q) { ui.mode = 'people'; ui.query = q; renderSurf(); }

// ---------- Drawer ----------
function openDrawer(content, back) {
  $('#drawer-body').replaceChildren(content);
  $('#drawer-body').scrollTop = 0;
  const backBtn = $('#drawer-back');
  backBtn.classList.toggle('hidden', !back);
  if (back) { backBtn.innerHTML = `${icon.back}<span>${back.label}</span>`; backBtn.onclick = back.go; }
  drawer.classList.add('open');
}
function closeDrawer() { drawer.classList.remove('open'); drawerState = null; history.length = 0; }
$('#drawer-close').innerHTML = icon.x;
$('#drawer-close').onclick = () => { closeDrawer(); grid.clearHighlight(); runSearch(); };

function backFor() {
  const prev = history[history.length - 1];
  if (!prev) return null;
  const label = prev.kind === 'pipeline' ? pipeline[prev.id].short : first(person[prev.id].name);
  return { label, go: () => { history.pop(); prev.kind === 'pipeline' ? openPipeline(prev.id, { push: false }) : openPerson(prev.id, { push: false }); } };
}

function openPerson(id, { zoom = false, push = true, path } = {}) {
  if (push && drawerState && drawerState.id !== id) history.push(drawerState);
  drawerState = { kind: 'person', id };
  if (id === ME) {
    openDrawer(profileView(ME, { showPaths: false }), backFor());
    grid.highlight({ selected: ME });
    return;
  }
  const rel = relationship(id);
  const paths = pathways(id, 3);
  const showPath = p => { grid.highlight({ path: p.nodes, selected: id }); grid.fit(p.nodes, { pad: 160, maxK: 1.6 }); };
  openDrawer(profileView(id, { onShowPath: showPath, onRequest: tid => openRequestModal(tid, { onChange: refresh }) }), backFor());
  if (path) showPath(path);
  else if (rel.type === 'close' || rel.type === 'acq') { grid.highlight({ selected: id }); if (zoom) grid.zoomToNode(id, 1.5); }
  else if (paths.length) { grid.highlight({ path: paths[0].nodes, selected: id, inferredTo: id }); grid.fit(paths[0].nodes, { pad: 160, maxK: 1.6 }); }
  else { grid.highlight({ selected: id, inferredTo: id }); grid.fit([ME, id], { pad: 200, maxK: 1.4 }); }
  runSearchActive();
}
function runSearchActive() { surf.querySelectorAll('.res').forEach(r => r.classList.remove('active')); }

function openPipeline(pid, { push = true } = {}) {
  if (push && drawerState && !(drawerState.kind === 'pipeline' && drawerState.id === pid)) history.push(drawerState);
  drawerState = { kind: 'pipeline', id: pid };
  const p = pipeline[pid];
  const ms = members(pid).filter(m => m.id !== ME);
  const mine = myConnectionsIn(pid);
  const isMember = person[ME].pipelines.includes(pid);
  const body = h('div', {},
    h('div', { class: 'pipe-head' }, h('div', { class: 'pipe-swatch', style: `background:${p.color}` }, p.short[0]),
      h('div', { class: 'col', style: 'gap:2px' }, h('div', { class: 'eyebrow' }, 'Pipeline'), h('h2', { style: 'font-size:20px' }, p.name))),
    h('p', { style: 'color:var(--ink-2)' }, p.description),
    h('div', { class: 'stat-row', style: 'margin-top:14px' },
      h('div', {}, h('b', {}, ms.length), h('span', {}, 'members')),
      h('div', {}, h('b', {}, mine.length), h('span', {}, 'you know')),
      h('div', {}, h('b', {}, karmaBadge(pipelineKarma(pid))), h('span', {}, 'community karma'))),
    h('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' },
      isMember ? h('span', { class: 'tag ok', html: `${icon.check}<span>You’re a member</span>` }) : h('span', { class: 'tag' }, 'Not a member'),
      h('span', { class: 'muted', style: 'font-size:12px' }, `Rule: ${p.rule}`)),
    h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'Bridges to other Pipelines'),
      h('div', { class: 'wrap' }, bridges(pid).filter(b => b.pipeline.id !== 'harvard').map(b => h('button', {
        class: 'chip', onClick: () => { ui.mode = 'bridge'; ui.from = pid; ui.to = b.pipeline.id; renderSurf(); },
      }, h('span', { class: 'dot', style: `background:${b.pipeline.color}` }), `${b.pipeline.short} · ${b.people.length}`)))),
    h('div', { class: 'section' }, h('div', { class: 'eyebrow' }, 'Recent helpful activity'),
      h('div', { class: 'ledger' }, p.activity.map(a => h('div', { class: 'ledger-row' }, avatar(a.who, 'sm'),
        h('div', { style: 'flex:1' }, h('b', {}, person[a.who].name), ' ', a.text, h('div', { class: 'faint', style: 'font-size:11.5px' }, a.ago + ' ago')),
        h('span', { class: 'karma' }, '+' + a.karma))))),
    h('div', { class: 'section people-list' }, h('div', { class: 'eyebrow' }, `Members · ${ms.length}`),
      ms.sort((a, b) => (relationship(a.id).type === 'potential') - (relationship(b.id).type === 'potential')).map(m => h('div', { class: 'res', onClick: () => openPerson(m.id, { zoom: true }) },
        avatar(m.id, 'sm'), h('div', { class: 'meta' }, h('b', {}, m.name), h('p', {}, personLine(m.id))),
        h('span', { class: 'deg' }, { close: 'Close', acq: 'Acquaintance', potential: 'Potential', unknown: '—', none: '' }[relationship(m.id).type]))))
  );
  openDrawer(body, backFor());
  grid.highlight({ focusCluster: pid });
  grid.zoomToCluster(pid);
}

// ---------- Live updates ----------
function refresh() {
  grid.refresh();
  if (drawerState?.kind === 'person') openPerson(drawerState.id, { push: false });
  else if (drawerState?.kind === 'pipeline') openPipeline(drawerState.id, { push: false });
}
subscribe(() => refresh());

renderSurf();

// ---------- Guided demo ----------
guide('a', [
  { title: 'This is Jordan’s Grid', text: 'You’re at the center. Each tinted circle is a Pipeline. Solid lines are confirmed relationships; thicker means close. Scroll to zoom, drag to pan.', run: () => { closeDrawer(); grid.clearHighlight(); grid.fit(); }, runLabel: 'Reset view' },
  { title: 'Zoom into a Pipeline', text: 'Click the Harvard Baseball circle to see its members, the people you already know there, and its community karma.', run: () => openPipeline('baseball') },
  { title: 'Surf the Grid', text: 'Search in plain language. Try “private equity alumni” across your entire Grid. Matches light up, and each result says why it matched.', run: () => { closeDrawer(); ui.scope = 'grid'; setQuery('private equity alumni'); } },
  { title: 'Open a recommended alum', text: 'Marcus Hale ’14 is a PE vice president and a former Harvard pitcher. The Grid shows the strongest route to him: through your coach.', run: () => openPerson('marcus') },
  { title: 'Compare pathways', text: 'In the drawer, the strongest path and two alternatives use only confirmed relationships. The dashed “shared affiliation” is marked as inferred.', run: () => { openPerson('marcus'); grid.highlight({ paths: pathways('marcus', 3).map(p => p.nodes), selected: 'marcus' }); grid.fit(pathways('marcus', 3).flatMap(p => p.nodes), { pad: 140 }); } },
  { title: 'Request an introduction', text: 'Choose a pathway, edit the pre-written note, and send. Nothing actually leaves the page.', run: () => openRequestModal('marcus', { onChange: refresh }) },
  { title: 'Watch the network strengthen', text: 'Simulate Coach Whitaker’s response (clearly labeled as a demo). A new edge appears in the Grid and the coach earns karma for Harvard Baseball.', run: () => {
    let r = requestFor('marcus');
    if (!r) { openRequestModal('marcus', { onChange: refresh }); toast('Send the request first, then simulate a response.'); return; }
    if (r.status === 'sent') { simulateResponse(r.id, { connector: r.path[1], pipeline: 'baseball' }); toast(`<span>${person[r.path[1]]?.name || 'Marcus'} made the introduction</span><span class="k">+15 karma · Baseball</span>`); }
    openPerson('marcus', { push: false }); grid.highlight({ path: [ME, 'marcus'], selected: 'marcus' }); grid.fit([ME, 'marcus', 'whitaker'], { pad: 200 });
  } },
  { title: 'Bridge two Pipelines', text: 'Switch to “Between Pipelines” to see who bridges Harvard Baseball and Crestline Partners, plus your shortest route into Crestline.', run: () => { ui.from = 'baseball'; ui.to = 'crestline'; setMode('bridge'); } },
]);

document.body.append(h('div', { style: 'position:fixed;right:16px;top:64px;z-index:6' }, fictionNote()));
