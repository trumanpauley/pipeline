// Concept C — Pipeline First
import { ME, person, pipeline, PIPELINES, members, myConnectionsIn, myPipelines, pipelineKarma, personKarma, bridges, relationship, search, pathways, routeIntoPipeline, helpLabel, first, edgeBetween } from './graph.js';
import { HELP_REQUESTS } from './data.js';
import { h, $, icon, topbar, avatar, personLine, profileView, openRequestModal, karmaBadge, guide, toast, pathwayView, fictionNote, relBadge, pipelineTag } from './ui.js';
import { createGrid } from './gridview.js';
import { resultsView } from './surf.js';
import { getState, subscribe, respondToHelp } from './state.js';

$('#top').replaceWith(topbar('c'));
const app = $('#app');
const drawer = $('#drawer');
let grid = null;
let drawerId = null;
const ui = { query: '', scopeAll: false, filter: 'all' };

$('#drawer-close').innerHTML = icon.x;
$('#drawer-close').onclick = closeDrawer;

function parse() {
  const hsh = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = hsh.split('/');
  if (a === 'p' && pipeline[b]) return { view: 'pipeline', pid: b, tab: c || 'grid' };
  if (a === 'grid') return { view: 'mygrid', pid: pipeline[b] ? b : null };
  return { view: 'home' };
}
function render() {
  grid?.destroy(); grid = null;
  const r = parse();
  app.className = r.view === 'home' ? 'page' : 'page wide';
  if (r.view === 'pipeline') renderPipeline(r.pid, r.tab);
  else if (r.view === 'mygrid') renderMyGrid(r.pid);
  else renderHome();
}
window.addEventListener('hashchange', () => { closeDrawer(); ui.query = ''; render(); window.scrollTo({ top: 0 }); });
subscribe(() => {
  const r = parse();
  if (grid) grid.refresh();
  if (r.view === 'home') renderHome();
  else if (r.view === 'pipeline' && r.tab !== 'grid') renderPipeline(r.pid, r.tab);
  if (drawerId) openPerson(drawerId);
});

// ---------- Drawer ----------
function openPerson(id) {
  drawerId = id;
  const r = parse();
  $('#drawer-body').replaceChildren(profileView(id, {
    onRequest: tid => openRequestModal(tid),
    onShowPath: grid ? (pt => { grid.highlight({ path: pt.nodes.filter(n => grid.pos[n]), selected: id }); }) : null,
  }));
  drawer.classList.add('open');
  if (grid && grid.pos[id]) {
    const paths = pathways(id, 1);
    const visible = paths[0]?.nodes.every(n => grid.pos[n]);
    grid.highlight(visible ? { path: paths[0].nodes, selected: id } : { selected: id, inferredTo: grid.pos[ME] ? id : undefined });
  }
}
function closeDrawer() { drawer.classList.remove('open'); drawerId = null; grid?.clearHighlight(); }

// ---------- Home ----------
function renderHome() {
  const mine = myPipelines().filter(p => p.id !== 'harvard').concat(pipeline.harvard);
  const known = new Set(mine.flatMap(p => myConnectionsIn(p.id).map(x => x.id)));
  const others = PIPELINES.filter(p => !person[ME].pipelines.includes(p.id));
  const overlaps = [];
  for (const p of mine) for (const b of bridges(p.id)) {
    if (b.pipeline.id === 'harvard' || p.id === 'harvard') continue;
    if (person[ME].pipelines.includes(b.pipeline.id) && b.pipeline.id < p.id) continue;
    overlaps.push({ a: p, b: b.pipeline, n: b.people.length });
  }
  overlaps.sort((x, y) => y.n - x.n);

  app.replaceChildren(
    h('div', { class: 'row', style: 'align-items:flex-end;flex-wrap:wrap;gap:16px' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Your Pipelines'),
        h('h1', { class: 'big', style: 'margin-top:8px' }, 'Your communities, ', h('em', { style: 'color:var(--signal-ink)' }, 'connected.')),
        h('p', { class: 'muted', style: 'margin-top:8px' }, `${mine.length} Pipelines · ${known.size} people you know across them · every Pipeline has its own Grid, members and karma.`)),
      h('span', { class: 'spacer' }),
      h('a', { class: 'btn', href: '#/grid', html: `${icon.layers}<span>Zoom out to My Grid</span>` })),
    h('div', { class: 'pipes' }, mine.map(p => pipeCard(p))),
    h('div', { class: 'sec-title' }, h('h2', {}, 'Where your Pipelines overlap'), h('span', { class: 'muted', style: 'font-size:13px' }, 'Shared members bridge communities. Click one to see it on your Grid.')),
    h('div', { class: 'overlaps' }, overlaps.slice(0, 8).map(o => h('a', { class: 'ov', href: `#/grid/${o.a.id}`, style: 'text-decoration:none', onClick: () => { pendingBridge = o.b.id; } },
      h('span', { class: 'dots' }, h('i', { style: `background:${o.a.color}` }), h('i', { style: `background:${o.b.color}` })),
      h('span', {}, `${o.a.short} ↔ ${o.b.short}`), h('b', {}, o.n), h('span', { class: 'muted' }, o.n === 1 ? 'bridge' : 'bridges')))),
    h('div', { class: 'sec-title' }, h('h2', {}, 'Pipelines you could join')),
    h('div', { class: 'more' }, others.map(p => {
      const rt = routeIntoPipeline(p.id);
      return h('div', { class: 'card hover', onClick: () => { location.hash = `#/p/${p.id}`; } },
        h('div', { class: 'row' }, h('span', { class: 'avatar sm', style: `border-radius:8px;--c:${p.color}` }, p.short[0]), h('b', {}, p.name)),
        h('p', { class: 'muted', style: 'font-size:13px' }, p.description),
        h('div', { class: 'row', style: 'font-size:12.5px;flex-wrap:wrap' }, h('span', { class: 'tag' }, `${members(p.id).length} members`),
          rt && h('span', { class: 'tag ok' }, `You know ${first(person[rt.nodes[1]].name)} → ${rt.hops === 1 ? 'member' : 'in'}`)),
        h('span', { class: 'faint', style: 'font-size:12px' }, `Membership: ${p.rule}`));
    })),
  );
}

function pipeCard(p) {
  const ms = members(p.id).filter(m => m.id !== ME);
  const known = myConnectionsIn(p.id);
  const open = HELP_REQUESTS.filter(x => x.pipeline === p.id && !getState().responded[x.id]);
  const act = p.activity[0];
  return h('article', { class: 'card hover pcard', onClick: () => { location.hash = `#/p/${p.id}`; } },
    h('div', { class: 'band', style: `background:${p.color}` }),
    h('div', { class: 'inner' },
      h('div', { class: 'row' }, h('h3', {}, p.name), h('span', { class: 'spacer' }), karmaBadge(pipelineKarma(p.id))),
      h('div', { class: 'nums' },
        h('div', {}, h('b', {}, ms.length), h('span', {}, 'members')),
        h('div', {}, h('b', {}, known.length), h('span', {}, 'you know')),
        h('div', {}, h('b', {}, open.length), h('span', {}, 'open asks'))),
      h('div', { class: 'stack' }, known.slice(0, 6).map(m => avatar(m.id, 'sm')), ms.length > known.length && h('span', { class: 'muted', style: 'font-size:12px;margin-left:8px;align-self:center' }, `+${ms.length - known.length} more`)),
      act && h('div', { class: 'act' }, avatar(act.who, 'sm'), h('span', {}, h('b', {}, first(person[act.who].name)), ' ', act.text), h('span', { class: 'spacer' }), h('span', { class: 'karma' }, '+' + act.karma)),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('span', { class: 'btn sm primary' }, 'Enter Pipeline →'))));
}

// ---------- Pipeline page ----------
function renderPipeline(pid, tab) {
  const p = pipeline[pid];
  const ms = members(pid).filter(m => m.id !== ME);
  const isMember = person[ME].pipelines.includes(pid);
  const myKarma = getState().karmaEvents.filter(e => e.who === ME && e.pipeline === pid).reduce((s, e) => s + e.amount, 0);
  const head = h('header', { class: 'phead' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Your Pipelines'), '/', h('span', { style: 'color:var(--ink)' }, p.name)),
    h('div', { class: 'title' },
      h('span', { class: 'badge', style: `background:${p.color}` }, p.short[0]),
      h('div', { class: 'col', style: 'gap:4px' }, h('h1', {}, p.name),
        h('span', { class: 'muted', style: 'font-size:13px' }, isMember ? `Member · ${p.rule}` : `Not a member · ${p.rule}`)),
      h('div', { class: 'kpis' },
        h('div', {}, h('b', {}, ms.length), h('span', {}, 'members')),
        h('div', {}, h('b', {}, myConnectionsIn(pid).length), h('span', {}, 'you know')),
        h('div', {}, h('b', {}, karmaBadge(pipelineKarma(pid))), h('span', {}, 'community karma')),
        isMember && h('div', {}, h('b', {}, karmaBadge(myKarma)), h('span', {}, 'your contribution')))),
    h('nav', { class: 'tabs' }, [['grid', 'Grid'], ['members', 'Members'], ['karma', 'Help & karma']].map(([k, l]) =>
      h('a', { href: `#/p/${pid}/${k}`, class: tab === k ? 'active' : '' }, l))));
  const body = h('div', { class: 'pbody' });
  app.replaceChildren(head, body);
  if (tab === 'members') renderMembers(body, pid);
  else if (tab === 'karma') renderKarma(body, pid);
  else renderPipelineGrid(body, pid);
}

function renderPipelineGrid(body, pid) {
  const p = pipeline[pid];
  const ids = [...new Set([ME, ...members(pid).map(m => m.id)])];
  const sub = ['baseball', 'eng', 'startups', 'lakeside', 'crestline', 'finance'].filter(x => x !== pid);
  const canvas = h('div', { class: 'canvas' });
  const results = h('div', { class: 'results' });
  const input = h('input', { class: 'input', placeholder: `Search ${p.short}…`, value: ui.query, autocomplete: 'off' });
  const scope = h('div', { class: 'seg' },
    h('button', { class: ui.scopeAll ? '' : 'active', onClick: () => { ui.scopeAll = false; renderPipelineGrid(body, pid); } }, `In ${p.short}`),
    h('button', { class: ui.scopeAll ? 'active' : '', onClick: () => { ui.scopeAll = true; renderPipelineGrid(body, pid); } }, 'All'));
  body.replaceChildren(h('div', { class: 'gridwrap' }, canvas,
    h('div', { class: 'card gpanel' }, h('div', { class: 'head' },
      h('div', { class: 'row' }, h('b', { style: 'font-size:15px' }, 'Surf the Grid'), h('span', { class: 'spacer' }), scope),
      h('div', { class: 'search-box', html: icon.search }, input),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ['private equity', 'investment banking', 'coach', 'Crestline'].map(q => h('button', { class: 'chip', style: 'height:26px;font-size:12px', onClick: () => { input.value = q; ui.query = q; run(); } }, q)))),
      results),
    h('a', { class: 'btn zoomout', href: `#/grid/${pid}`, html: `${icon.layers}<span>Zoom out to My Grid</span>` }),
    h('div', { class: 'subhint' }, `Tinted groups are other Pipelines inside ${p.short}. Click one to cross over.`)));

  grid?.destroy();
  grid = createGrid(canvas, {
    nodes: ids, clusters: sub, minCluster: 2, layout: { radius: 230 },
    insets: () => ({ top: 0, left: window.innerWidth > 900 ? 360 : 0, right: drawer.classList.contains('open') && window.innerWidth > 900 ? 420 : 0, bottom: 0 }),
    onSelect: id => openPerson(id),
    onCluster: q => { location.hash = `#/p/${q}`; toast(`Crossed from ${p.short} into ${pipeline[q].name}`); },
    onBackground: () => { closeDrawer(); run(); },
  });

  function run() {
    const q = ui.query.trim();
    if (!q) { results.replaceChildren(); grid.clearHighlight(); return; }
    const res = search(q, { scope: ui.scopeAll ? 'grid' : pid });
    results.replaceChildren(...resultsView(res, { onPerson: id => {
      if (!grid.pos[id]) { toast(`${person[id].name} isn’t in ${p.short}. Showing their profile.`); }
      openPerson(id);
    } }));
    grid.highlight({ matches: res.people.map(r => r.id).filter(id => grid.pos[id]) });
  }
  input.addEventListener('input', () => { ui.query = input.value; run(); });
  if (ui.query) run();
}

function renderMembers(body, pid) {
  const all = members(pid).filter(m => m.id !== ME);
  const filters = [['all', 'All'], ['known', 'People you know'], ['alum', 'Alumni'], ['help', 'Very responsive']];
  const list = h('div', { class: 'card' });
  const input = h('input', { class: 'input', placeholder: 'Filter members…', autocomplete: 'off' });
  const draw = () => {
    const q = input.value.trim();
    let rows = q ? search(q, { scope: pid }).people.map(r => person[r.id]) : all;
    rows = rows.filter(m => ui.filter === 'all' || (ui.filter === 'known' && edgeBetween(ME, m.id)) || (ui.filter === 'alum' && m.role === 'alum') || (ui.filter === 'help' && m.helpfulness >= 0.85));
    list.replaceChildren(...(rows.length ? rows.map(m => h('div', { class: 'mrow', onClick: () => openPerson(m.id) },
      avatar(m.id), h('div', { class: 'col', style: 'gap:1px;min-width:0' }, h('b', {}, m.name), h('span', { class: 'muted', style: 'font-size:12.5px' }, personLine(m.id))),
      relBadge(m.id), karmaBadge(personKarma(m.id)))) : [h('p', { class: 'muted', style: 'padding:18px' }, 'No members match.')]));
  };
  input.addEventListener('input', draw);
  body.replaceChildren(h('div', { class: 'list-wrap' },
    h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-bottom:14px' },
      h('div', { class: 'search-box', style: 'width:min(340px,100%)', html: icon.search }, input),
      filters.map(([k, l]) => h('button', { class: `chip ${ui.filter === k ? 'active' : ''}`, onClick: () => { ui.filter = k; renderMembers(body, pid); } }, l))),
    list));
  draw();
}

function renderKarma(body, pid) {
  const p = pipeline[pid];
  const s = getState();
  const asks = HELP_REQUESTS.filter(x => x.pipeline === pid);
  const events = s.karmaEvents.filter(e => e.pipeline === pid).slice().reverse();
  const isMember = person[ME].pipelines.includes(pid);
  body.replaceChildren(h('div', { class: 'list-wrap' }, h('div', { class: 'karma-grid' },
    h('div', { class: 'col', style: 'gap:16px' },
      h('div', { class: 'card pad' }, h('div', { class: 'row' }, h('h2', { style: 'font-size:16px' }, 'Open asks'), h('span', { class: 'spacer' }), h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Help a member, earn karma')),
        asks.length ? asks.map(a => {
          const done = s.responded[a.id];
          return h('div', { class: 'help' }, avatar(a.from),
            h('div', { class: 'col', style: 'gap:4px;flex:1' }, h('b', {}, person[a.from].name), h('span', {}, a.text),
              done && h('span', { class: 'tag ok', style: 'align-self:flex-start', html: `${icon.check}<span>You responded · +${a.karma} karma</span>` })),
            !done && h('button', { class: 'btn sm', disabled: !isMember, title: isMember ? '' : 'Members only', onClick: () => {
              respondToHelp(a);
              toast(`<span>You helped ${first(person[a.from].name)}</span><span class="k">+${a.karma} karma · ${p.short}</span>`);
            } }, 'Respond'));
        }) : h('p', { class: 'muted', style: 'padding-top:12px' }, 'No open asks right now.')),
      h('div', { class: 'card pad' }, h('h2', { style: 'font-size:16px;margin-bottom:6px' }, 'Recent helpful activity'),
        h('div', { class: 'ledger' },
          events.map(e => h('div', { class: 'ledger-row' }, avatar(e.who, 'sm'), h('div', { style: 'flex:1' }, h('b', {}, e.who === ME ? 'You' : person[e.who].name), ' ', e.label, ' ', h('span', { class: 'tag demo' }, 'Demo')), h('span', { class: 'karma' }, '+' + e.amount))),
          p.activity.map(a => h('div', { class: 'ledger-row' }, avatar(a.who, 'sm'), h('div', { style: 'flex:1' }, h('b', {}, person[a.who].name), ' ', a.text, h('div', { class: 'faint', style: 'font-size:11.5px' }, a.ago + ' ago')), h('span', { class: 'karma' }, '+' + a.karma)))))),
    h('div', { class: 'col', style: 'gap:16px' },
      h('div', { class: 'card pad' }, h('div', { class: 'eyebrow' }, 'Community karma'),
        h('div', { class: 'kbig', style: 'margin-top:6px' }, karmaBadge(pipelineKarma(pid))),
        h('p', { class: 'muted', style: 'margin-top:8px;font-size:13px' }, `The total helpful activity generated by ${p.name} members. It measures generosity, not popularity, so there are no follower counts.`)),
      h('div', { class: 'card pad' }, h('div', { class: 'eyebrow' }, 'How karma is earned'),
        h('div', { class: 'rules' },
          h('span', {}, 'Respond to a request'), karmaBadge('+5'),
          h('span', {}, 'Give advice or a resume review'), karmaBadge('+10'),
          h('span', {}, 'Facilitate an introduction'), karmaBadge('+15'),
          h('span', {}, 'Mentor someone over time'), karmaBadge('+20')),
        h('p', { class: 'muted', style: 'margin-top:12px;font-size:12.5px' }, 'Karma is only earned when the person helped confirms it, which keeps it hard to game.')),
    ))));
}

// ---------- My Grid (zoomed out) ----------
let pendingBridge = null;
function renderMyGrid(pid) {
  const canvas = h('div', { class: 'canvas' });
  const panel = h('div', { class: 'card gpanel' });
  app.replaceChildren(h('div', { class: 'mygrid' }, canvas, panel,
    h('a', { class: 'btn zoomout', href: pid ? `#/p/${pid}` : '#/', html: `${icon.back}<span>${pid ? 'Back into ' + pipeline[pid].short : 'Your Pipelines'}</span>` })));
  grid = createGrid(canvas, {
    insets: () => ({ top: 0, left: window.innerWidth > 900 ? 360 : 0, right: drawer.classList.contains('open') && window.innerWidth > 900 ? 420 : 0, bottom: 0 }),
    onSelect: id => openPerson(id),
    onCluster: q => { location.hash = `#/grid/${q}`; },
    onBackground: () => closeDrawer(),
  });
  const sel = pid || 'baseball';
  let target = pendingBridge && pendingBridge !== sel ? pendingBridge : null;
  pendingBridge = null;
  const drawPanel = () => {
    const br = bridges(sel).filter(b => b.pipeline.id !== 'harvard');
    panel.replaceChildren(h('div', { class: 'head' },
      h('div', { class: 'eyebrow' }, 'My Grid · zoomed out'),
      h('b', { style: 'font-size:15px' }, `${pipeline[sel].name} and its neighbors`),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, myPipelines().filter(p => p.id !== 'harvard').map(p =>
        h('a', { class: `chip ${p.id === sel ? 'active' : ''}`, href: `#/grid/${p.id}`, style: 'text-decoration:none' }, h('span', { class: 'dot', style: `background:${p.color}` }), p.short)))),
      h('div', { class: 'results' },
        h('div', { class: 'group-label' }, 'Bridges into other Pipelines'),
        br.map(b => h('div', { class: 'res', style: target === b.pipeline.id ? 'background:var(--bg)' : '', onClick: () => { target = b.pipeline.id; show(); drawPanel(); } },
          h('span', { class: 'avatar sm', style: `border-radius:8px;--c:${b.pipeline.color}` }, b.pipeline.short[0]),
          h('div', { class: 'meta' }, h('b', {}, b.pipeline.name), h('p', {}, b.people.map(x => first(x.name)).join(', '))),
          h('span', { class: 'deg' }, b.people.length))),
        target && h('div', { style: 'padding:6px' },
          h('div', { class: 'group-label', style: 'padding-left:4px' }, `Your route into ${pipeline[target].short}`),
          routeIntoPipeline(target) ? pathwayView(routeIntoPipeline(target)) : h('p', { class: 'muted' }, 'No confirmed route yet.'),
          h('a', { class: 'btn sm', href: `#/p/${target}`, style: 'margin-top:10px' }, `Enter ${pipeline[target].short} →`))));
  };
  const show = () => {
    if (target) {
      const both = members(sel).filter(m => m.pipelines.includes(target) && m.id !== ME).map(m => m.id);
      const rt = routeIntoPipeline(target);
      grid.highlight({ focusCluster: sel, matches: both, path: rt?.nodes, lit: members(target).map(m => m.id) });
      grid.fit([...members(sel), ...members(target)].map(m => m.id), { pad: 120 });
    } else {
      grid.highlight({ focusCluster: sel });
      setTimeout(() => grid.zoomToCluster(sel), 50);
    }
  };
  drawPanel();
  setTimeout(show, 60);
}

render();

guide('c', [
  { title: 'Your Pipelines are home', text: 'Instead of a feed, you start from the communities you belong to. Each card shows its size, the people you know, open asks and community karma.', run: () => { location.hash = '#/'; }, runLabel: 'Go home' },
  { title: 'Enter Harvard Baseball', text: 'Every Pipeline gets its own Grid. Tinted groups inside it show where Baseball overlaps with Crestline, Engineering and the founder community.', run: () => { location.hash = '#/p/baseball'; } },
  { title: 'Surf this Pipeline', text: 'Search “private equity” inside Baseball only, then flip the scope to Entire Grid to compare.', run: () => { ui.query = 'private equity'; ui.scopeAll = false; location.hash === '#/p/baseball' ? render() : (location.hash = '#/p/baseball'); } },
  { title: 'Open Marcus and request an intro', text: 'The profile shows confirmed routes (through Coach Whitaker) and the inferred shared affiliation, kept clearly separate.', run: () => { if (!location.hash.startsWith('#/p/baseball')) location.hash = '#/p/baseball'; setTimeout(() => openPerson('marcus'), 120); } },
  { title: 'Help and karma', text: 'Pipelines run on generosity. Respond to Owen’s open ask and watch your contribution and the community karma update.', run: () => { location.hash = '#/p/baseball/karma'; } },
  { title: 'Zoom out', text: 'Zoom out to your personal Grid to see Baseball beside your other Pipelines, who bridges them, and your route into Crestline.', run: () => { pendingBridge = 'crestline'; location.hash = '#/grid/baseball'; } },
]);
document.body.append(h('div', { style: 'position:fixed;right:16px;bottom:14px;z-index:6' }, fictionNote()));
