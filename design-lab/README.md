# Pipeline Design Lab

Three interactive interface concepts for Pipeline, built on one shared fictional network. This folder is separate from the Beta 1.1 app in the repo root and doesn't touch it.

- **A · Grid First:** the network is the homepage.
- **B · Discovery First:** explained recommendations come first; the Grid appears when you explore a person.
- **C · Pipeline First:** your communities are home, and each has its own Grid, members and karma.

## Run it

You only need Python 3. There's nothing to install and no API keys.

```sh
python -m http.server 4180 --directory design-lab
```

Then open <http://localhost:4180>. Use a server rather than opening the files directly, because the JavaScript modules don't load from `file://`.

Everything runs in the browser. Demo actions (swipes, intro requests, karma) are saved in `localStorage` and carry across all three concepts. **Reset demo** in the top bar clears them.

## What's inside

| File | Purpose |
| --- | --- |
| `index.html` | Landing page: concept switcher, dataset stats, comparison table |
| `concept-a.html`, `concept-b.html`, `concept-c.html` | The three concepts |
| `js/data.js` | Shared fictional dataset: 42 people, 7 Pipelines, ~80 confirmed relationships, opportunities, help requests |
| `js/graph.js` | Graph engine: Dijkstra pathways, BFS degrees, search, recommendation scoring, karma |
| `js/gridview.js` | SVG Grid renderer: deterministic force layout, pan/zoom/pinch, cluster outlines, path highlighting |
| `js/ui.js` | Shared components: profile, pathways, intro request flow, swipe deck, guided demo |
| `js/state.js` | Demo state stored in localStorage |
| `css/lab.css` | Design system |

### How the logic works (no AI, no external services)

- **Relationships.** Confirmed edges are `close` (cost 1) or `acquaintance` (cost 2). A shared Pipeline is shown only as an *inferred affiliation* (dashed line) and never counts as a relationship.
- **Pathways.** Dijkstra finds the strongest route. Up to two alternatives are found by rerunning it with the earlier routes' middle people excluded, so the alternatives go through different people.
- **Search.** The query is split into words, with synonyms (`PE` → private equity, `IB` → investment banking). Every word must match a field. Results are ranked by which field matched, plus closeness (BFS degree) and responsiveness. Scope can be the entire Grid or a single Pipeline.
- **Recommendations.** Score = shared interests with your goal (up to 30) + shared Pipelines, weighted toward smaller and tighter communities (up to 36) + willingness to help (up to 20) + path strength (up to 24) + alumni bonus (6). Concept B shows the breakdown under "Why this score?".
- **Karma.** Respond to a request +5, give advice +10, facilitate an introduction +15, mentor +20. A Pipeline's karma is the sum of its members' helpful activity.
- **Simulations.** Intro responses and karma gains are labeled "Demo" / "Simulated". Nothing is ever sent.

## Guided demos (~60–90 seconds each)

Each concept has a guide card in the bottom-left. **Show me** performs each step for you.

**A · Grid First**
1. The Grid: you at the center, Pipelines as tinted clusters, solid lines for confirmed relationships.
2. Click **Harvard Baseball**: the drawer shows members, people you know, bridges and community karma.
3. Search `private equity alumni` across the entire Grid: matches light up, and each says why it matched.
4. Open **Marcus Hale**: the strongest path through Coach Whitaker lights up.
5. Compare the three confirmed pathways with the inferred shared affiliation.
6. **Request an introduction**: choose a pathway and send the pre-written note.
7. **Simulate a response**: a new edge appears, and Coach Whitaker earns +15 karma for Harvard Baseball.
8. **Between Pipelines**: Baseball → Crestline shows the bridge members and your route in.

**B · Discovery First**
1. Recommendations with reasons: shared Pipelines, interests, responsiveness and path.
2. Open **Why this score?** on the top card.
3. Switch the goal to *Startups & venture* and watch the ranking change.
4. Back on private equity, **Explore connection** for Marcus: a left-to-right map of every route.
5. Request an introduction and simulate the response.
6. **Sort your network**: swipe right (acquaintance), left (don't know), or press and hold (close). The buttons do the same.
7. Turn on **New user (small network)**: recommendations still work with only 2 confirmed relationships.

**C · Pipeline First**
1. Home is your Pipelines, with members, people you know, open asks and karma.
2. Enter **Harvard Baseball**: its own Grid, with sub-clusters where it overlaps other Pipelines.
3. Search `private equity` inside Baseball, then switch the scope to All.
4. Open Marcus and request an introduction.
5. **Help & karma**: respond to Owen's ask; your contribution and community karma go up.
6. **Zoom out to My Grid**: see Baseball's bridges, pick Crestline, and see your route in.

## Comparison

| | A · Grid First | B · Discovery First | C · Pipeline First |
| --- | --- | --- | --- |
| **Strengths** | Most distinctive; overlaps and bridges visible at a glance; "how do I reach them" is literal | Fastest time to value; works with a tiny network; swipe deck turns inferred links into confirmed relationships | Matches how people think ("my team"); natural home for karma, rules and asks; growth one Pipeline at a time |
| **Weaknesses** | Can overwhelm new users; needs density; harder on mobile | Risks feeling like a generic "people you may know"; Grid is secondary; quality depends on scoring | Cross-community discovery takes an extra step; small Pipelines can feel empty; closer to existing group products |
| **Test with users** | Can a first-timer find a path to an alum in under 60s? Do solid vs dashed lines make sense without the legend? | Do users trust the "why"? Do they finish a 10-card swipe session, and does it feel private enough? | Do members help others without a direct benefit? Do they discover "zoom out" on their own? |
| **Success metric** | Time to first intro request | Intro requests per recommendation shown | Weekly help responses per Pipeline |

## Data note

All 42 people, the firms (Crestline Partners, Northfield Capital, Beacon & Lowell, and others) and every relationship are invented. Harvard community names are used only to frame the proof of concept. None of these people are real students, staff or alumni.
