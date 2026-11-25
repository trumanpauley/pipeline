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
async function join(token, name, category = 'Harvard alumnus/alumna') {
  const u = await newUser();
  await as(u, `select public.open_invitation($1, null)`, [token]);
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

// ── Experiments: an existing (V1) one, and a test-only V2 one
const [{ id: v1Exp }] = (await db.query(`select id from public.experiments where is_default limit 1`)).rows;
const [{ id: v2Exp }] = (await db.query(
  `insert into public.experiments (name, invites_per_participant, categories, status, community_name, is_test)
   values ('ABC V2 test', 2, '["Current Harvard student", "Harvard alumnus/alumna"]', 'active', 'the Harvard Baseball team', true) returning id`)).rows;

step('Defaults: nothing moves to V2 on its own');
const exps = (await db.query(`select name, abc_version, abc_enabled from public.experiments`)).rows;
ok(exps.every((e) => e.abc_version === 'v1'), 'every experiment (existing and new) starts on V1');
ok((await db.query(`select abc_enabled from public.experiments where id = $1`, [v1Exp])).rows[0].abc_enabled === true, 'existing ABC on/off setting untouched');

step('Admin: choose V2 with custom scenarios');
ok(/forbidden/.test(await err(as(await newUser(), `select public.admin_save_experiment_abc($1, 'v2', 1, null)`, [v2Exp]))), 'only admins can change the ABC version');
ok(/invalid_scenarios/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, $2)`, [v2Exp, JSON.stringify([{ key: 'Bad Key', label: 'x', university: 'a', group: 'b', direct_question: 'c', warm_question: 'd' }])]))), 'scenario keys are validated');
const scen = [
  { key: 'student', label: 'Current Harvard student', university: 'Imagine {name} is a Harvard first-year asking about classes.', group: 'Imagine {name} is a Harvard first-year on {group} asking about classes.', direct_question: 'How likely would you be to respond if {name} reached out to you directly?', warm_question: 'How likely would you be to respond if {inviter} personally introduced {name} to you?' },
  { key: 'alumni', label: 'Harvard alumnus/alumna', university: 'Imagine {name} is a Harvard junior looking for advice about internship opportunities.', group: 'Imagine {name} is a Harvard junior on {group} looking for advice about internship opportunities.', direct_question: 'How likely would you be to respond if {name} reached out to you directly?', warm_question: 'How likely would you be to respond if {inviter} personally introduced {name} to you?' },
];
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, $2)`, [v2Exp, JSON.stringify(scen)]);
let ex = (await db.query(`select * from public.experiments where id = $1`, [v2Exp])).rows[0];
ok(ex.abc_version === 'v2' && ex.abc_enabled && ex.abc_min_depth === 1 && ex.abc_v2_revision === 2, 'V2 saved; new wording bumps the revision');
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 1, $2)`, [v2Exp, JSON.stringify(scen)]);
ok((await db.query(`select abc_v2_revision from public.experiments where id = $1`, [v2Exp])).rows[0].abc_v2_revision === 2, 'saving the same wording keeps the revision');

step('Named broadcast link (Ryan)');
const [ryanTok] = await seeds(v2Exp, 'Ryan Mooney', 'broadcast');
const al = await join(ryanTok, 'Alice A.');
let st = await one(al, `select public.get_my_state()`);
ok(st.abc.version === 'v2' && st.abc.eligible === true && st.abc.completed === false, 'generation-1 broadcast joiner is eligible for V2');
let g = await one(al, `select public.get_abc_v2()`);
ok(g.needs_knows === true && g.intermediary.name === 'Ryan' && g.intermediary.type === 'broadcast_sender', 'asks how well they know Ryan first');
ok((await db.query(`select count(*)::int n from public.abc_v2_responses`)).rows[0].n === 0, 'nothing is recorded before they answer the dial');
ok((await one(al, `select public.set_abc_v2_knows(true, null, 1200)`)).error === 'invalid_value', 'knowing Ryan needs a dial value');
g = await one(al, `select public.set_abc_v2_knows(true, 12, 1800)`);
ok(g.order.length === 3 && new Set(g.order).size === 3 && g.order.includes('warm'), 'knows Ryan (even weakly, 12%): all three questions');
ok(g.questions.warm.question.includes('Ryan personally introduced') && g.questions.warm.question.includes(g.name), 'warm question names Ryan and the same Jane/John');
ok(g.questions.shared_group.scenario.includes('on the Harvard Baseball team') && !g.questions.university.scenario.includes('Baseball'), '{group} filled in; question 1 mentions only the university');
ok(g.questions.university.question === g.questions.shared_group.question, 'questions 1 and 2 ask the same thing (only the affiliation differs)');
ok(g.questions.shared_group.scenario === g.questions.warm.scenario, 'questions 2 and 3 share the scenario (only the introduction differs)');
let row = (await db.query(`select * from public.abc_v2_responses where participant_id = (select id from public.participants where user_id = $1)`, [al.sub])).rows[0];
ok(row.intermediary_type === 'broadcast_sender' && row.knows_intermediary === true && row.knows_source === 'self_report' && row.connection_strength === 12 && row.strength_source === 'v2_dial', 'stored as a self-reported tie to a broadcast sender, not a referral');
ok(row.classification === 'alumni' && row.link_kind === 'seed_broadcast' && row.depth === 1 && row.scenario_revision === 2, 'group, link type, generation and wording revision stored');
ok((await db.query(`select parent_id from public.participants where user_id = $1`, [al.sub])).rows[0].parent_id === null, 'no referral edge is created to Ryan');
ok((await one(al, `select public.set_abc_v2_knows(false, null, 100)`)).error === 'abc_started', "the dial answer can't be changed after starting");
for (const q of g.order) g = await one(al, `select public.answer_abc_v2($1, $2)`, [q, q === 'university' ? 2 : q === 'shared_group' ? 4 : 5]);
ok(g.completed === true, 'complete after all three');
ok((await one(al, `select public.answer_abc_v2('warm', 1)`)).error === 'abc_completed', 'answers are locked once complete');
st = await one(al, `select public.get_my_state()`);
ok(st.abc.completed === true, 'home card shows complete');

const bo = await join(ryanTok, 'Bob B.', 'Current Harvard student');
g = await one(bo, `select public.set_abc_v2_knows(false, 88, 900)`);
ok(g.order.length === 2 && !g.order.includes('warm') && !g.questions.warm, "doesn't know Ryan: questions 1 and 2 only");
row = (await db.query(`select * from public.abc_v2_responses where participant_id = (select id from public.participants where user_id = $1)`, [bo.sub])).rows[0];
ok(row.knows_intermediary === false && row.connection_strength === null && row.warm_eligible === false, 'no strength stored when they don’t know him (the dial value is discarded)');
ok((await one(bo, `select public.answer_abc_v2('warm', 3)`)).error === 'invalid_value', 'a skipped question cannot be answered');
for (const q of g.order) g = await one(bo, `select public.answer_abc_v2($1, 3)`, [q]);
row = (await db.query(`select * from public.abc_v2_responses where participant_id = (select id from public.participants where user_id = $1)`, [bo.sub])).rows[0];
ok(g.completed && row.warm === null, 'complete with warm stored as NULL, not 0');

step('Unnamed broadcast link');
const [anonTok] = await seeds(v2Exp, '', 'broadcast');
const ca = await join(anonTok, 'Cara C.');
g = await one(ca, `select public.get_abc_v2()`);
ok(!g.needs_knows && g.order.length === 2 && g.intermediary.type === 'none' && g.intermediary.knows === null, 'no sender: straight to questions 1 and 2');

step('Personal referral (generation 2) and personal seed');
const [persTok] = await seeds(v2Exp, 'Truman P.', 'personal');
const dan = await join(persTok, 'Dan D.');
g = await one(dan, `select public.get_abc_v2()`);
ok(g.intermediary.type === 'seed_sender' && g.intermediary.name === 'Truman' && g.order.length === 3, 'personal seed link: all three, introduced by the founder');
await one(dan, `select public.dismiss_community_prompt()`).catch(() => undefined);
const inv = await invite(dan, 'Eve E.');
const eve = await join(inv.token, 'Eve E.');
g = await one(eve, `select public.get_abc_v2()`);
row = (await db.query(`select * from public.abc_v2_responses where participant_id = (select id from public.participants where user_id = $1)`, [eve.sub])).rows[0];
ok(g.intermediary.type === 'inviter' && g.intermediary.name === 'Dan' && g.order.length === 3 && row.knows_source === 'referral' && row.depth === 2, 'personal referral: all three, introduced by the inviter');

step('Group question when the join answer does not match');
const [t2] = await seeds(v2Exp, 'Ryan Mooney', 'broadcast');
const fr = await join(t2, 'Fay F.');
await db.query(`update public.participants set classification = null, category = null where user_id = $1`, [fr.sub]); // e.g. joined before groups were asked
g = await one(fr, `select public.get_abc_v2()`);
ok(g.needs_classification === true && g.groups.length === 2, 'asks which group first');
ok((await one(fr, `select public.set_abc_v2_knows(true, 50, 100)`)).error === 'needs_classification', "can't skip the group question");
g = await one(fr, `select public.set_abc_v2_group('student')`);
ok(g.needs_knows === true, 'then the dial');

step('Randomised order is stored and varies');
const orders = new Set((await db.query(`select array_to_string(question_order, '>') o from public.abc_v2_responses`)).rows.map((r) => r.o));
ok(orders.size >= 2, `question orders vary (${[...orders].join(' | ')})`);

step('V1 unchanged');
const [v1Seed] = (await one(ADMIN, `select public.admin_create_experiment_seeds_v2($1, 1, 'Truman', 'v1', 'personal')`, [v1Exp])).map((s) => s.token);
const g1 = await join(v1Seed, 'Gil G.');
const i1 = await invite(g1, 'Hal H.');
const h1 = await join(i1.token, 'Hal H.');
const i2 = await invite(h1, 'Ida I.');
const id3 = await join(i2.token, 'Ida I.');
st = await one(id3, `select public.get_my_state()`);
ok(st.abc.version === 'v1' && st.abc.eligible === true, 'V1 experiment: generation 3 still gets V1 (now labelled v1)');
const v1 = await one(id3, `select public.get_abc()`);
ok(v1.eligible && (v1.order === 'cold_first' || v1.order === 'warm_first') && v1.inviter_name === 'Hal', 'get_abc returns the same V1 payload');
ok((await one(h1, `select public.get_my_state()`)).abc.eligible === false, 'V1 generation 2 still not eligible (min generation 3)');
ok((await one(id3, `select public.get_abc_v2()`)).eligible === false, 'V2 functions do nothing in a V1 experiment');
ok((await one(al, `select public.get_abc()`)).eligible === false, 'V1 functions do nothing in a V2 experiment');

step('Version lock');
ok(/abc_version_locked/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v1', 1, null)`, [v2Exp]))), "can't switch V2 → V1 once there are answers");
await as(ADMIN, `select public.answer_abc('cold', 3)`).catch(() => undefined);
await as(id3, `select public.answer_abc('cold', 2)`);
ok(/abc_version_locked/.test(await err(as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', 3, null)`, [v1Exp]))), "can't switch a live V1 experiment with answers to V2");
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'none', null, null)`, [v2Exp]);
ex = (await db.query(`select abc_enabled, abc_version from public.experiments where id = $1`, [v2Exp])).rows[0];
ok(ex.abc_enabled === false && ex.abc_version === 'v2', 'turning ABC off keeps the version');
await as(ADMIN, `select public.admin_save_experiment_abc($1, 'v2', null, null)`, [v2Exp]);

step('Analytics and export');
const s2 = await one(ADMIN, `select public.admin_abc_v2_stats($1, null)`, [v2Exp]);
ok(s2.participation.started === 5 && s2.participation.completed === 2, `participation counted (${s2.participation.started} started, ${s2.participation.completed} completed)`);
ok(s2.paired.group_vs_university.n === 2 && Number(s2.paired.group_vs_university.diff) === 1, 'shared group vs university: paired difference');
ok(s2.paired.warm_vs_group.n === 1 && Number(s2.paired.warm_vs_group.diff) === 1, 'warm vs shared group: only people who answered both');
ok(s2.participation.knows_sender >= 1 && s2.participation.doesnt_know_sender === 1, 'knows / doesn’t know Ryan counted');
ok(s2.by_strength.some((b) => b.band === 'doesnt_know') && s2.by_strength.some((b) => b.band === '0-24'), 'by connection strength, with “doesn’t know” separate');
ok(s2.by_link.some((b) => b.link === 'broadcast') && s2.by_link.some((b) => b.link === 'personal'), 'broadcast vs personal referral');
const all = await one(ADMIN, `select public.admin_abc_v2_stats(null, null)`);
ok(all.participation.started === 0, 'test experiments are left out unless picked');
const csv = await one(ADMIN, `select public.admin_export('abc_v2')`);
ok(csv.length === 5 && 'knows_intermediary' in csv[0] && !('display_name' in csv[0]) && !JSON.stringify(csv).includes('Alice'), 'abc_v2 export: one row each, no names');
const oldCsv = await one(ADMIN, `select public.admin_export('abc')`);
ok(Array.isArray(oldCsv) && oldCsv.length === 1, 'V1 export unchanged');
ok(/forbidden/.test(await err(as(al, `select public.admin_abc_v2_stats(null, null)`))), 'analytics are admin-only');
ok(/permission denied/.test(await err(as({ role: 'anon' }, `select public.get_abc_v2()`))), 'logged-out visitors cannot call V2');
ok(/permission denied/.test(await err(as(al, `select * from public.abc_v2_responses`))), 'participants cannot read the answers table');

step('Erasure');
await as(bo, `select public.delete_my_data()`);
ok((await db.query(`select count(*)::int n from public.abc_v2_responses a join public.participants p on p.id = a.participant_id where p.user_id = $1`, [bo.sub])).rows[0].n === 0, 'delete my data removes V2 answers');

console.log(`\n${passed} checks passed`);
