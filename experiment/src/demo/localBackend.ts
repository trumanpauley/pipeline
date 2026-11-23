// Browser-only demo backend (build:demo). Runs the real Postgres schema — the
// same shim + migrations the tests use — inside the page with PGlite, and
// answers supabase-js's auth and RPC requests through a custom fetch. Data is
// kept in this browser's IndexedDB. Never used by the normal build.
import { PGlite } from '@electric-sql/pglite';
import shimSql from '../../test/local-supabase-shim.sql?raw';
import m001 from '../../supabase/migrations/001_experiment_schema.sql?raw';
import m002 from '../../supabase/migrations/002_anonymous_onboarding.sql?raw';
import m003 from '../../supabase/migrations/003_share_tracking.sql?raw';
import m004 from '../../supabase/migrations/004_phone_ready.sql?raw';
import m005 from '../../supabase/migrations/005_name_moderation.sql?raw';
import m006 from '../../supabase/migrations/006_circular_strength.sql?raw';
import m007 from '../../supabase/migrations/007_invited_names.sql?raw';
import m008 from '../../supabase/migrations/008_live_invitation_tracking.sql?raw';
import m009 from '../../supabase/migrations/009_pipeline_community.sql?raw';
import m010 from '../../supabase/migrations/010_multi_experiment.sql?raw';
import m011 from '../../supabase/migrations/011_early_access.sql?raw';
import m012 from '../../supabase/migrations/012_connection_strength_abc.sql?raw';
import m013 from '../../supabase/migrations/013_copy_safe_name_check.sql?raw';
import m014 from '../../supabase/migrations/014_community_onboarding.sql?raw';
import m015 from '../../supabase/migrations/015_optional_relationship_question.sql?raw';

// Like PostgREST: arrays and objects are passed as JSON (not as Postgres arrays).
const jsonArg = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const CODE = '123456';
const ADMIN = 'admin@demo.dev';
const SQL = [shimSql, m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015];
// A new schema gets a new database, so an old demo can't break a newer build.
const DB_KEY = `pipeline-demo-${SQL.reduce((n, s) => n + s.length, 0)}`;

type Row = Record<string, unknown>;
interface User { id: string; email: string | null; email_confirmed_at: string | null; phone: string | null; phone_confirmed_at: string | null; raw_user_meta_data: Row; created_at: string }

let dbPromise: Promise<PGlite> | null = null;
const codes = new Map<string, { userId?: string }>();

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function forgetSessions() {
  const ls = storage();
  if (!ls) return;
  for (const k of Object.keys(ls)) if (k.startsWith('sb-') || k.startsWith('px.')) ls.removeItem(k);
}

async function open(): Promise<PGlite> {
  const ls = storage();
  if (ls && ls.getItem('px.demo.db') !== DB_KEY) {
    forgetSessions(); // sessions from an older demo database are meaningless here
    ls.setItem('px.demo.db', DB_KEY);
  }
  let db: PGlite;
  try {
    db = new PGlite(`idb://${DB_KEY}`);
    await db.waitReady;
  } catch {
    db = new PGlite(); // private mode etc.: in-memory, lost on reload
    await db.waitReady;
  }
  const { rows } = await db.query<{ ok: boolean }>(`select to_regclass('public.participants') is not null as ok`);
  if (!rows[0].ok) {
    for (const sql of SQL) await db.exec(sql);
    await db.exec(`
      insert into public.admins (email) values ('${ADMIN}');
      update public.experiment_settings set value = '{"joins_per_ip_hour": 100000, "opens_per_ip_hour": 100000,
        "waitlist_per_ip_hour": 100000, "invites_per_participant_hour": 1000}' where key = 'rate_limits';`);
  }
  return db;
}

const getDb = () => (dbPromise ??= open());

// ---------- tokens (demo only: unsigned) ----------
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

function accessToken(u: User) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email ?? '', is_anonymous: !u.email && !u.phone, iat: now, exp: now + 3600 };
  return `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify(claims))}.demo`;
}
function claimsOf(token: string | null): Row | null {
  try {
    const c = JSON.parse(unb64u((token ?? '').split('.')[1]));
    return c.exp > Date.now() / 1000 ? c : null;
  } catch { return null; }
}

const userJson = (u: User) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email ?? '',
  email_confirmed_at: u.email_confirmed_at, phone: u.phone ?? '', phone_confirmed_at: u.phone_confirmed_at,
  is_anonymous: !u.email && !u.phone,
  app_metadata: u.email ? { provider: 'email', providers: ['email'] } : { provider: 'anonymous', providers: ['anonymous'] },
  user_metadata: u.raw_user_meta_data, created_at: u.created_at, updated_at: u.created_at,
});
const session = (u: User) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken(u), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: `${u.id}.${Math.random().toString(36).slice(2)}`, user: userJson(u),
  };
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function userBy(col: 'id' | 'email' | 'phone', v: unknown): Promise<User | undefined> {
  const db = await getDb();
  return (await db.query<User>(`select * from auth.users where ${col} = $1`, [v])).rows[0];
}

/** Drop-in `fetch` for supabase-js. */
export async function localFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
  const body: Row = raw ? JSON.parse(raw) : {};
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const db = await getDb();

  try {
    switch (true) {
      // ----- phone (demo: no SMS is sent; the code is always 123456) -----
      case url.pathname === '/auth/v1/otp' && Boolean(body.phone): {
        if (!(await userBy('phone', body.phone)) && body.create_user === false) {
          return json(422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
        }
        codes.set(`phone:${body.phone}`, {});
        return json(200, {});
      }
      case url.pathname === '/auth/v1/user' && req.method === 'PUT' && Boolean(body.phone): {
        const u = await userBy('id', claimsOf(bearer)?.sub);
        if (!u) return json(401, { code: 401, msg: 'invalid JWT' });
        const taken = await userBy('phone', body.phone);
        if (taken && taken.id !== u.id) return json(422, { code: 422, error_code: 'phone_exists', msg: 'A user with this phone number has already been registered' });
        codes.set(`phone:${body.phone}`, { userId: u.id });
        return json(200, { ...userJson(u), new_phone: body.phone });
      }
      case url.pathname === '/auth/v1/verify' && Boolean(body.phone): {
        const key = `phone:${body.phone}`;
        const entry = codes.get(key) ?? (body.type !== 'phone_change' && (await userBy('phone', body.phone)) ? {} : undefined);
        if (!entry || String(body.token) !== CODE) {
          return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        }
        codes.delete(key);
        const u = body.type === 'phone_change' && entry.userId
          ? (await db.query<User>(`update auth.users set phone = $1, phone_confirmed_at = now() where id = $2 returning *`, [body.phone, entry.userId])).rows[0]
          : (await db.query<User>(`update auth.users set phone_confirmed_at = coalesce(phone_confirmed_at, now()) where phone = $1 returning *`, [body.phone])).rows[0];
        return json(200, session(u));
      }
      case url.pathname === '/auth/v1/otp': {
        const email = String(body.email).toLowerCase();
        if (!(await userBy('email', email))) {
          await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2)`, [email, body.data ?? {}]);
        }
        codes.set(email, {});
        return json(200, {});
      }
      case url.pathname === '/auth/v1/signup' && !body.email: {
        const u = (await db.query<User>(`insert into auth.users (email, raw_user_meta_data) values (null, $1) returning *`, [body.data ?? {}])).rows[0];
        return json(200, session(u));
      }
      case url.pathname === '/auth/v1/user' && req.method === 'PUT': {
        const u = await userBy('id', claimsOf(bearer)?.sub);
        if (!u) return json(401, { code: 401, msg: 'invalid JWT' });
        const email = String(body.email ?? '').toLowerCase();
        if (email) {
          const taken = await userBy('email', email);
          if (taken && taken.id !== u.id) return json(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
          codes.set(email, { userId: u.id });
        }
        return json(200, { ...userJson(u), new_email: email || undefined });
      }
      case url.pathname === '/auth/v1/user': {
        const u = await userBy('id', claimsOf(bearer)?.sub);
        return u ? json(200, userJson(u)) : json(401, { code: 401, msg: 'invalid JWT' });
      }
      case url.pathname === '/auth/v1/verify': {
        const email = String(body.email).toLowerCase();
        // Sign-in codes survive a reload (the code is fixed); linking needs the pending entry.
        const entry = codes.get(email) ?? (body.type !== 'email_change' && (await userBy('email', email)) ? {} : undefined);
        if (!entry || String(body.token) !== CODE) {
          return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        }
        codes.delete(email);
        const u = body.type === 'email_change' && entry.userId
          ? (await db.query<User>(`update auth.users set email = $1, email_confirmed_at = now() where id = $2 returning *`, [email, entry.userId])).rows[0]
          : (await db.query<User>(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email = $1 returning *`, [email])).rows[0];
        return json(200, session(u));
      }
      case url.pathname === '/auth/v1/token': {
        const u = await userBy('id', String(body.refresh_token ?? '').split('.')[0]);
        return u ? json(200, session(u)) : json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      case url.pathname === '/auth/v1/logout':
        return new Response(null, { status: 204 });
    }

    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      const claims = claimsOf(bearer) ?? { role: 'anon' };
      const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
      const keys = Object.keys(body);
      try {
        const result = await db.transaction(async (tx) => {
          await tx.query(`set local role ${role}`);
          await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
          await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': '127.0.0.1', 'user-agent': navigator.userAgent })]);
          const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
          return (await tx.query<{ result: unknown }>(`select public.${m[1]}(${args}) as result`, keys.map((k) => jsonArg(body[k])))).rows[0].result;
        });
        return json(200, result);
      } catch (e) {
        const err = e as { code?: string; message: string };
        const status = err.code === '42501' ? 403 : err.code === '42883' ? 404 : 400;
        return json(status, { code: err.code, message: err.message, details: null, hint: null });
      }
    }
    return json(404, { message: 'not found' });
  } catch (e) {
    return json(500, { message: (e as Error).message });
  }
}

/** Demo helper: a fresh seed invitation so the flow can be replayed. */
export async function newInvite(): Promise<string> {
  const db = await getDb();
  const { rows } = await db.query<{ token: string }>(
    `insert into public.invitations (token, sender_name, admin_note) values (public.px_new_token(), 'Truman', 'demo') returning token`);
  return rows[0].token;
}

/** Wipe this browser's demo: database, sessions and demo state. */
export async function resetAll() {
  try { await (await getDb()).close(); } catch { /* ignore */ }
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(`/pglite/${DB_KEY}`);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  forgetSessions();
  window.location.href = window.location.href.split('#')[0] + '#/';
  window.location.reload();
}
