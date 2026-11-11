// Shared "Surf the Grid" result rendering.
import { person, pipeline, degreeLabel, members } from './graph.js';
import { h, avatar, personLine, icon } from './ui.js';

export const SUGGESTED_QUERIES = ['private equity alumni', 'investment banking', 'Crestline', 'sports business', 'restructuring', 'venture capital', 'coach'];

export function resultsView(res, { onPerson, onHover, onPipeline, onOpportunity, activeId, limit = 30 } = {}) {
  const out = [];
  if (res.people.length) {
    out.push(h('div', { class: 'group-label' }, `People · ${res.people.length}`));
    res.people.slice(0, limit).forEach(r => {
      const p = person[r.id];
      out.push(h('div', {
        class: `res ${activeId === r.id ? 'active' : ''}`, onClick: () => onPerson?.(r.id),
        onMouseenter: () => onHover?.(r.id), onMouseleave: () => onHover?.(null),
      },
        avatar(r.id, 'sm'),
        h('div', { class: 'meta' }, h('b', {}, p.name), h('p', {}, personLine(r.id)),
          r.matched.length ? h('div', { class: 'why' }, r.matched.slice(0, 3).map(m => h('span', { class: 'tag' }, `${m.label}: ${m.value.length > 26 ? m.value.slice(0, 24) + '…' : m.value}`))) : null),
        h('span', { class: 'deg' }, degreeLabel(r.hops))));
    });
  }
  if (res.opportunities.length) {
    out.push(h('div', { class: 'group-label' }, `Opportunities · ${res.opportunities.length}`));
    res.opportunities.forEach(o => out.push(h('div', { class: 'res', onClick: () => onOpportunity?.(o) },
      h('span', { class: 'avatar sm', style: 'border-radius:8px;--c:var(--signal)', html: icon.sparkle }),
      h('div', { class: 'meta' }, h('b', {}, o.title), h('p', {}, `${o.org} · hosted by ${person[o.host].name} · ${o.when}`)))));
  }
  if (res.pipelines.length) {
    out.push(h('div', { class: 'group-label' }, `Pipelines · ${res.pipelines.length}`));
    res.pipelines.forEach(p => out.push(h('div', { class: 'res', onClick: () => onPipeline?.(p.id) },
      h('span', { class: 'avatar sm', style: `border-radius:8px;--c:${p.color}` }, p.short[0]),
      h('div', { class: 'meta' }, h('b', {}, p.name), h('p', {}, `${members(p.id).length} members`)))));
  }
  if (!out.length && res.terms.length) {
    out.push(h('div', { class: 'muted', style: 'padding:14px;font-size:13px' }, 'No matches. Try a broader scope or one of the suggestions.'));
  }
  return out;
}

export { pipeline };
