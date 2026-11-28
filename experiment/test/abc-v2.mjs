// ABC V2 (migration 021): database checks, and that ABC V1 is unchanged.
// Runs every migration in an in-memory PGlite database, so it needs no Postgres
// and never touches Supabase. Usage: npm run test:abc-v2
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(path.join(root, 'package.json'));
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);

const db = new PGlite();
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
await db.exec(read('test/local-supabase-shim.sql'));
const migs = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of migs) await db.exec(read(`supabase/migrations/${f}`));
await db.exec(read('supabase/migrations/021_abc_v2.sql')); // safe to run twice

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('  ok  ' + m); };
const step = (s) => console.log('\n' + s);

const ADMIN = { sub: '00000000-0000-0000-0000-00000000000a', email: 'admin@example.com', role: 'authenticated' };
await db.query(`insert into public.admins (email) values ($1)`, [ADMIN.email]);
await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [ADMIN.sub, ADMIN.email]);
let ipN = 1;
async function as(claims, sql, args = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': `10.1.${Math.floor(ipN / 200)}.${ipN++ % 200}`, 'user-agent': 't' })]);
    await tx.query(`set local role ${claims.role ?? 'authenticated'}`);
    return (await tx.query(sql, args)).rows;
  });
}
const one = async (claims, sql, args) => Object.values((await as(claims, sql, args))[0])[0];
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
let uN = 0;
async function newUser() {
  const id = `00000000-0000-0000-0000-${String(++uN).padStart(12, '0')}`;
  await db.query(`insert into auth.users (id) values ($1)`, [id]);
  return { sub: id, role: 'authenticated', is_anonymous: true };
}
/** Open a link, optionally rate the sender (onboarding's closeness question), and join. */
async function join(token, name, { category = 'Harvard alumnus/alumna', closeness = null } = {}) {
  const u = await newUser();
  await as(u, `select public.open_invitation($1, null)`, [token]);
  if (closeness) await as(u, `select public.rate_relationship($1, $2, null)`, [token, closeness]);
  const r = await one(u, `select public.accept_invitation($1, $2, true, false, null, $3, true)`, [token, name, category]);
  if (!['joined', 'already_participant'].includes(r.state)) throw new Error('join failed: ' + JSON.stringify(r));
  return u;
}
async function invite(u, label) {
  const [{ v }] = (await db.query(`select (public.px_setting('method_options') -> (select method from public.participants where user_id = $1 and deleted_at is null order by created_at desc limit 1)) ->> 0 as v`, [u.sub])).rows;
  return one(u, `select public.create_invitation($1, $2, 500)`, [v, label]);
}
const seeds = async (exp, name, kind, n = 1) =>
  (await one(ADMIN, `select public.admin_create_experiment_seeds_v2($1, $2, $3, 'test', $4)`, [exp, n, name, kind])).map((s) => s.token);
const rowOf = async (u) => (await db.query(`select * from public.abc_v2_responses where participant_id = (select id from public.participants where user_id = $1)`, [u.sub])).rows[0];
const newExperiment = async (name) => (await db.query(
  `insert into public.experiments (name, invites_per_participant, categories, status, is_test)
   values ($1, 2, '["Current Harvard student", "Harvard alumnus/alumna"]', 'active', true) returning id`, [name])).rows[0].id;
const ALL = ['university', 'shared_group', 'warm'];

const [{ id: v1Exp }] = (await db.query(`select id from public.experiments where is_default limit 1`)).rows;
const hb = await newExperiment('Baseball V2 internal name');
const club = await newExperiment('Club V2 internal name');

step('Defaults: nothing moves to V2 on its own');
ok((await db.query(`select bool_and(abc_version = 'v1') ok from public.experiments`)).rows[0].ok, 'every experiment starts on V1');
const def = (await db.query(`select abc_v2_scenarios s from public.experiments where id = $1`, [hb])).rows[0].s;
ok(def.length === 2 && def.every((g) => g.direct_contact && g.warm_contact && !('direct_question' in g)), 'default V2 wording has a description plus a separate contact line');

step('Admin: V2 needs a shared group, never the internal name');
ok(/invalid_group/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, null, null)`, [hb]))), 'V2 without a shared group is refused');
ok(/invalid_group/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, null, $2)`, [hb, 'x'.repeat(81)]))), 'shared group is limited to 80 characters');
ok(/forbidden/.test(await err(as(await newUser(), `select public.admin_save_experiment_abc($1, 'v2', 1, null, 'on a team')`, [hb]))), 'only admins can change it');
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, null, 'on the Harvard Baseball team')`, [hb]);
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, null, 'in the Example Club')`, [club]);
let ex = (await db.query(`select * from public.experiments where id = $1`, [hb])).rows[0];
ok(ex.abc_version === 'v2' && ex.abc_v2_group === 'on the Harvard Baseball team' && ex.abc_v2_revision === 2, 'saved; a new shared group is a new wording revision');
ok(/invalid_scenarios/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, $2, null)`, [hb, JSON.stringify([{ key: 'alumni', label: 'A', university: 'u', group: 'g', direct_contact: '', warm_contact: 'w' }])]))), 'every wording field is required');

for (const [exp, groupPhrase, sender] of [[hb, 'on the Harvard Baseball team', 'Ryan Mooney'], [club, 'in the Example Club', 'Sam Lee']]) {
  const first = sender.split(' ')[0];
  step(`Named broadcast link (${groupPhrase}, sent by ${first})`);
  const [tok] = await seeds(exp, sender, 'broadcast');
  const a = await join(tok, 'Alice A.', { closeness: 4 });
  let st = await one(a, `select public.get_my_state()`);
  ok(st.abc.version === 'v2' && st.abc.eligible && !st.abc.completed, 'generation-1 broadcast joiner is eligible');
  let g = await one(a, `select public.get_abc_v2()`);
  ok(!('needs_knows' in g) && g.order.length === 3 && ALL.every((q) => g.order.filter((x) => x === q).length === 1), 'no extra screen: all three questions, each exactly once');
  ok(g.questions.university.scenario === `${g.name} is a Harvard junior looking for internship advice.`, 'question 1: shares only the university');
  ok(g.questions.shared_group.scenario === `${g.name} is a Harvard junior ${groupPhrase} looking for internship advice.`, 'question 2: the shared group phrase, same person and request');
  ok(!JSON.stringify(g.questions).includes('internal name'), 'the experiment’s internal name never appears');
  ok(g.questions.warm.scenario === g.questions.shared_group.scenario, 'question 3 has question 2’s description');
  ok(g.questions.university.contact === `${g.name} messages you directly.` && g.questions.shared_group.contact === g.questions.university.contact, 'questions 1 and 2: messaged directly');
  ok(g.questions.warm.contact === `${first} personally introduces you to ${g.name}.`, 'question 3: introduced by the sender');
  ok(ALL.every((q) => g.questions[q].question === 'How likely are you to respond?'), 'the same short question throughout');
  let row = await rowOf(a);
  ok(row.intermediary_type === 'broadcast_sender' && row.knows_intermediary === null && row.knows_source === null, 'broadcast sender: knowing them is not assumed, never a referral');
  ok(row.connection_strength === 75 && row.strength_source === 'onboarding_rating', 'their onboarding closeness rating of the sender is copied (4 of 5 → 75)');
  ok((await db.query(`select parent_id from public.participants where user_id = $1`, [a.sub])).rows[0].parent_id === null, 'no referral edge to the sender');
  // Back button: change an answer before finishing.
  const [q1, q2, q3] = g.order;
  await one(a, `select public.answer_abc_v2($1, 2)`, [q1]);
  await one(a, `select public.answer_abc_v2($1, 3)`, [q2]);
  g = await one(a, `select public.answer_abc_v2($1, 5)`, [q1]);
  ok(g.answers[q1] === 5 && !g.completed, 'an earlier answer can be changed before the last one');
  g = await one(a, `select public.answer_abc_v2($1, 4)`, [q3]);
  ok(g.completed && g.answers[q1] === 5, 'complete after the third answer');
  ok((await one(a, `select public.answer_abc_v2($1, 1)`, [q1])).error === 'abc_completed', 'locked once complete');

  step(`Unnamed broadcast link (${groupPhrase})`);
  const [anonTok] = await seeds(exp, '', 'broadcast');
  const c = await join(anonTok, 'Cara C.');
  g = await one(c, `select public.get_abc_v2()`);
  ok(g.order.length === 2 && !g.order.includes('warm') && !g.questions.warm && g.intermediary.type === 'none', 'questions 1 and 2 only');
  for (const q of g.order) g = await one(c, `select public.answer_abc_v2($1, 3)`, [q]);
  ok(g.completed && (await rowOf(c)).warm === null && (await rowOf(c)).warm_eligible === false, 'complete with the skipped question NULL, not 0');
  ok((await one(c, `select public.answer_abc_v2('warm', 3)`)).error, 'a question they weren’t asked can’t be answered');

  step(`Personal seed and personal referral (${groupPhrase})`);
  const [pTok] = await seeds(exp, 'Truman P.', 'personal');
  const d = await join(pTok, 'Dan D.', { category: 'Current Harvard student' });
  g = await one(d, `select public.get_abc_v2()`);
  ok(g.intermediary.type === 'seed_sender' && g.order.length === 3 && g.questions.warm.contact.startsWith('Truman personally introduces'), 'personal seed: introduced by the founder');
  ok(g.questions.shared_group.scenario.includes(`first-year ${groupPhrase}`), 'current students get their own wording');
  const inv = await invite(d, 'Eve E.');
  const e2 = await join(inv.token, 'Eve E.');
  g = await one(e2, `select public.get_abc_v2()`);
  row = await rowOf(e2);
  ok(g.intermediary.type === 'inviter' && g.questions.warm.contact.startsWith('Dan personally introduces') && row.knows_source === 'referral' && row.depth === 2, 'personal referral: introduced by the inviter');
}

step('Broadcast onboarding answers stay with each person');
{
  const [tok] = await seeds(hb, 'Ryan Mooney', 'broadcast');
  const [pt] = await seeds(hb, 'Truman P.', 'personal');
  ok((await one({ role: 'anon' }, `select public.open_invitation($1, null)`, [tok])).reusable === true, 'opening a broadcast link says it is reusable (the page signs the visitor in first)');
  ok(!('reusable' in (await one({ role: 'anon' }, `select public.open_invitation($1, null)`, [pt]))), 'personal links are not marked reusable');
  const x = await join(tok, 'Xia X.', { closeness: 5 });
  const y = await join(tok, 'Yan Y.', { closeness: 2 });
  const rr = (await db.query(`select p.display_name, r.closeness from public.relationship_ratings r join public.participants p on p.id = r.rater_id
    join public.invitations i on i.id = r.invitation_id where i.broadcast_parent = (select id from public.invitations where token = $1) order by 1`, [tok])).rows;
  ok(rr.length === 2 && rr[0].closeness === 5 && rr[1].closeness === 2, 'two signed-in visitors keep separate ratings, each tied to the person');
  await one(x, `select public.get_abc_v2()`);
  await one(y, `select public.get_abc_v2()`);
  ok((await rowOf(x)).connection_strength === 100 && (await rowOf(y)).connection_strength === 25, 'V2 copies each person’s own rating (5 of 5 → 100, 2 of 5 → 25)');
}

step('Randomised order is stored, each question once');
const orders = (await db.query(`select question_order o from public.abc_v2_responses`)).rows.map((r) => r.o);
ok(orders.every((o) => new Set(o).size === o.length), 'no question repeats in any order');
ok(new Set(orders.map((o) => o.join('>'))).size >= 2, 'orders vary between people');

step('Missing shared group: nobody gets V2');
const bare = await newExperiment('No group yet');
await db.query(`update public.experiments set abc_enabled = true, abc_version = 'v2', abc_min_depth = 1 where id = $1`, [bare]);
const [bt] = await seeds(bare, 'Ryan Mooney', 'broadcast');
const bj = await join(bt, 'Bea B.');
ok((await one(bj, `select public.get_my_state()`)).abc.eligible === false, 'V2 waits until the shared group is set');

step('V1 unchanged');
const [v1Seed] = await seeds(v1Exp, 'Truman', 'personal');
const g1 = await join(v1Seed, 'Gil G.');
const h1 = await join((await invite(g1, 'Hal H.')).token, 'Hal H.');
const i3 = await join((await invite(h1, 'Ida I.')).token, 'Ida I.');
let st = await one(i3, `select public.get_my_state()`);
ok(st.abc.version === 'v1' && st.abc.eligible, 'V1 experiment: generation 3 still gets V1');
const v1 = await one(i3, `select public.get_abc()`);
ok(v1.eligible && ['cold_first', 'warm_first'].includes(v1.order) && v1.inviter_name === 'Hal', 'same V1 payload');
ok((await one(h1, `select public.get_my_state()`)).abc.eligible === false, 'V1 generation 2 still not eligible');
ok((await one(i3, `select public.get_abc_v2()`)).eligible === false, 'V2 functions do nothing in a V1 experiment');
await as(i3, `select public.answer_abc('cold', 2)`);
ok(/abc_version_locked/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 3, null, 'on a team')`, [v1Exp]))), 'a V1 experiment with answers can’t switch to V2');
ok(/abc_version_locked/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v1', 1, null, null)`, [hb]))), 'a V2 experiment with answers can’t switch to V1');

step('Analytics and export');
const s2 = await one(ADMIN, `select public.admin_abc_v2_stats($1, null)`, [hb]);
ok(s2.participation.started === 6 && s2.participation.completed === 2 && s2.participation.named_broadcast === 3 && s2.participation.unnamed_broadcast === 1, 'participation counted');
ok(s2.paired.group_vs_university.n === 2 && s2.paired.warm_vs_group.n === 1, 'paired differences use only people who answered both');
ok(s2.by_strength.some((b) => b.band === '75-100') && s2.by_strength.some((b) => b.band === 'no_intermediary'), 'by connection strength');
ok((await one(ADMIN, `select public.admin_abc_v2_stats(null, null)`)).participation.started === 0, 'test experiments left out unless picked');
const csv = await one(ADMIN, `select public.admin_export('abc_v2')`);
ok(csv.length === 10 && !JSON.stringify(csv).includes('Alice'), 'abc_v2 export: one row each, no names');
ok(/permission denied/.test(await err(as({ role: 'anon' }, `select public.get_abc_v2()`))), 'logged-out visitors can’t call V2');
ok(/permission denied/.test(await err(as(await newUser(), `select * from public.abc_v2_responses`))), 'participants can’t read the answers table');
ok((await db.query(`select to_regprocedure('public.set_abc_v2_knows(boolean,integer,integer)') is null as gone`)).rows[0].gone, 'the "do you know the sender" step is removed');

step('Erasure');
function e2Last() { return { sub: `00000000-0000-0000-0000-${String(uN).padStart(12, '0')}`, role: 'authenticated' }; }
const last = e2Last();
await as(last, `select public.delete_my_data()`);
ok((await db.query(`select count(*)::int n from public.abc_v2_responses a join public.participants p on p.id = a.participant_id where p.user_id = $1`, [last.sub])).rows[0].n === 0, 'delete my data removes V2 answers');

console.log(`\n${passed} checks passed`);
