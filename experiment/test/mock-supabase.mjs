// Local stand-in for the two Supabase services the app talks to:
//   * GoTrue email OTP / magic link (/auth/v1/*)
//   * PostgREST RPC (/rest/v1/rpc/:fn) — executed against a real Postgres with
//     the same role switching + JWT claims PostgREST uses, so RLS and
//     SECURITY DEFINER behave exactly as in production.
// Test-only helpers live under /__test/*.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { WebSocketServer } from 'ws';

// Like PostgREST: arrays and objects are passed as JSON (not as Postgres arrays).
const jsonArg = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const SECRET = 'local-test-secret';
const b64u = (b) => Buffer.from(b).toString('base64url');

export function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig !== parts[2]) return null;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

export function startMockSupabase({ port, connectionString, fixedCode = null }) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  const codes = new Map(); // email -> { code, redirect }
  const refreshTokens = new Map(); // refresh -> user id

  const userRow = async (where, arg) =>
    (await pool.query(`select * from auth.users where ${where} = $1`, [arg])).rows[0];

  const userJson = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email ?? '',
    email_confirmed_at: u.email_confirmed_at,
    phone: u.phone ?? '',
    phone_confirmed_at: u.phone_confirmed_at,
    is_anonymous: !u.email && !u.phone,
    app_metadata: u.email ? { provider: 'email', providers: ['email'] } : { provider: 'anonymous', providers: ['anonymous'] },
    user_metadata: u.raw_user_meta_data,
    created_at: u.created_at,
    updated_at: u.created_at,
  });

  const session = (u) => {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJwt({
      sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email ?? '', exp: now + 3600, iat: now,
      is_anonymous: !u.email && !u.phone,
    });
    const refresh_token = crypto.randomBytes(16).toString('hex');
    refreshTokens.set(refresh_token, u.id);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(u) };
  };

  const confirm = async (email) =>
    (await pool.query(
      `update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email = $1 returning *`,
      [email],
    )).rows[0];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (status, body) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');

    try {
      // ---------------- auth ----------------
      // ----- phone (SMS) — no messages are ever sent; codes are readable via /__test/code?phone= -----
      const newCode = () => fixedCode ?? String(crypto.randomInt(100000, 999999));
      if (url.pathname === '/auth/v1/otp' && req.method === 'POST' && body.phone) {
        // signInWithOtp({ phone }) — returning participant
        const u = await userRow('phone', body.phone);
        if (!u && body.create_user === false) {
          return send(422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
        }
        codes.set(`phone:${body.phone}`, { code: newCode() });
        return send(200, {});
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'PUT' && body.phone) {
        // updateUser({ phone }) — link a phone to this (anonymous) user
        const claims = verifyJwt(bearer);
        const u = claims && (await userRow('id', claims.sub));
        if (!u) return send(401, { code: 401, msg: 'invalid JWT' });
        const taken = await userRow('phone', body.phone);
        if (taken && taken.id !== u.id) {
          return send(422, { code: 422, error_code: 'phone_exists', msg: 'A user with this phone number has already been registered' });
        }
        codes.set(`phone:${body.phone}`, { code: newCode(), userId: u.id });
        return send(200, { ...userJson(u), new_phone: body.phone });
      }
      if (url.pathname === '/auth/v1/verify' && req.method === 'POST' && body.phone) {
        const entry = codes.get(`phone:${body.phone}`);
        if (!entry || entry.code !== String(body.token)) {
          return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        }
        codes.delete(`phone:${body.phone}`);
        const u = body.type === 'phone_change' && entry.userId
          ? (await pool.query(`update auth.users set phone = $1, phone_confirmed_at = now() where id = $2 returning *`, [body.phone, entry.userId])).rows[0]
          : (await pool.query(`update auth.users set phone_confirmed_at = coalesce(phone_confirmed_at, now()) where phone = $1 returning *`, [body.phone])).rows[0];
        return send(200, session(u));
      }

      if (url.pathname === '/auth/v1/otp' && req.method === 'POST') {
        const email = String(body.email).toLowerCase();
        let u = await userRow('email', email);
        if (!u) {
          u = (await pool.query(
            `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *`,
            [email, body.data || {}],
          )).rows[0];
        }
        const code = fixedCode ?? String(crypto.randomInt(100000, 999999));
        codes.set(email, { code, redirect: url.searchParams.get('redirect_to') });
        return send(200, {});
      }
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST' && !body.email) {
        // signInAnonymously()
        const u = (await pool.query(
          `insert into auth.users (email, raw_user_meta_data) values (null, $1) returning *`, [body.data || {}],
        )).rows[0];
        return send(200, session(u));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
        // updateUser({ email }) — starts linking an email to this (anonymous) user
        const claims = verifyJwt(bearer);
        const u = claims && (await userRow('id', claims.sub));
        if (!u) return send(401, { code: 401, msg: 'invalid JWT' });
        const email = String(body.email || '').toLowerCase();
        if (email) {
          const taken = await userRow('email', email);
          if (taken && taken.id !== u.id) {
            return send(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
          }
          codes.set(email, { code: fixedCode ?? String(crypto.randomInt(100000, 999999)), redirect: url.searchParams.get('redirect_to'), userId: u.id });
        }
        return send(200, { ...userJson(u), new_email: email || undefined });
      }
      if (url.pathname === '/auth/v1/verify' && req.method === 'POST') {
        const email = String(body.email).toLowerCase();
        const entry = codes.get(email);
        if (!entry || entry.code !== String(body.token)) {
          return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        }
        codes.delete(email);
        if (body.type === 'email_change' && entry.userId) {
          const u = (await pool.query(
            `update auth.users set email = $1, email_confirmed_at = now() where id = $2 returning *`, [email, entry.userId],
          )).rows[0];
          return send(200, session(u));
        }
        return send(200, session(await confirm(email)));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const claims = verifyJwt(bearer);
        const u = claims && (await userRow('id', claims.sub));
        if (!u) return send(401, { code: 401, msg: 'invalid JWT' });
        return send(200, userJson(u));
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const id = refreshTokens.get(body.refresh_token);
        const u = id && (await userRow('id', id));
        if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return send(200, session(u));
      }
      if (url.pathname === '/auth/v1/logout') return send(204);

      // ---------------- rest rpc ----------------
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (m && req.method === 'POST') {
        const claims = verifyJwt(bearer) || { role: 'anon' };
        const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
        const keys = Object.keys(body);
        const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query(`set local role ${role}`);
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          await client.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip, 'user-agent': req.headers['user-agent'] ?? '' })]);
          const r = await client.query(`select public.${m[1]}(${args}) as result`, keys.map((k) => jsonArg(body[k])));
          await client.query('commit');
          return send(200, r.rows[0].result);
        } catch (e) {
          await client.query('rollback').catch(() => {});
          const status = e.code === '42501' ? 403 : e.code === '42883' ? 404 : 400;
          return send(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
        } finally {
          client.release();
        }
      }

      // ---------------- test helpers ----------------
      if (url.pathname === '/__test/new-invite' && req.method === 'POST') {
        // Demo helper: a fresh seed invitation so the flow can be replayed.
        const r = await pool.query(
          `insert into public.invitations (token, sender_name, admin_note)
           values (public.px_new_token(), 'Truman', 'demo') returning token`);
        return send(200, { token: r.rows[0].token });
      }
      if (url.pathname === '/__test/code') {
        const phone = url.searchParams.get('phone');
        return send(200, codes.get(phone ? `phone:${phone}` : url.searchParams.get('email')) ?? null);
      }
      if (url.pathname === '/__test/magic-link') {
        // What the real email's link resolves to after GoTrue verifies it.
        const email = url.searchParams.get('email');
        const entry = codes.get(email);
        if (!entry) return send(404, null);
        codes.delete(email);
        const s = session(await confirm(email));
        const hash = new URLSearchParams({
          access_token: s.access_token, refresh_token: s.refresh_token, expires_in: '3600',
          expires_at: String(s.expires_at), token_type: 'bearer', type: 'magiclink',
        });
        return send(200, { url: `${entry.redirect}#${hash}` });
      }

      console.warn('[mock] unhandled', req.method, url.pathname);
      return send(404, { message: 'not found' });
    } catch (e) {
      console.error('[mock] error', e);
      return send(500, { message: e.message });
    }
  });

  // ---------------- Realtime (postgres_changes) ----------------
  // A minimal stand-in for Supabase Realtime: Phoenix protocol v2 over
  // WebSocket, fed by a NOTIFY trigger on public.invitations. Like Supabase,
  // it only delivers rows the subscriber may read (RLS: invitations they sent).
  const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
  const subs = new Set(); // { ws, topic, joinRef, participantId, bindings: [{ id, event, table, filter }] }
  let bindingId = 1;
  const sendMsg = (ws, joinRef, ref, topic, event, payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify([joinRef, ref, topic, event, payload]));
  };
  const participantFor = async (token) => {
    const claims = verifyJwt(token);
    if (!claims?.sub) return null;
    return (await pool.query(`select id from public.participants where user_id = $1 and deleted_at is null`, [claims.sub])).rows[0]?.id ?? null;
  };
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const [joinRef, ref, topic, event, payload] = msg;
      if (topic === 'phoenix' && event === 'heartbeat') return sendMsg(ws, null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
      if (event === 'phx_join') {
        const bindings = (payload?.config?.postgres_changes ?? []).map((b) => ({ ...b, id: bindingId++ }));
        const sub = { ws, topic, joinRef, participantId: await participantFor(payload?.access_token), bindings };
        for (const old of subs) if (old.ws === ws && old.topic === topic) subs.delete(old);
        subs.add(sub);
        return sendMsg(ws, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } });
      }
      if (event === 'access_token') {
        for (const sub of subs) if (sub.ws === ws && sub.topic === topic) sub.participantId = await participantFor(payload?.access_token);
        return sendMsg(ws, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      }
      if (event === 'phx_leave') {
        for (const sub of subs) if (sub.ws === ws && sub.topic === topic) subs.delete(sub);
        return sendMsg(ws, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      }
    });
    ws.on('close', () => { for (const sub of subs) if (sub.ws === ws) subs.delete(sub); });
  });
  const matches = (filter, record) => {
    if (!filter) return true;
    const m = filter.match(/^(\w+)=eq\.(.+)$/);
    return m ? String(record[m[1]]) === m[2] : false;
  };
  const listener = new pg.Client({ connectionString });
  const realtimeReady = (async () => {
    await listener.connect();
    await listener.query(`
      create or replace function public.px_test_realtime_notify() returns trigger language plpgsql as $f$
      begin
        perform pg_notify('px_realtime', json_build_object('table', tg_table_name, 'type', tg_op,
          'record', row_to_json(new), 'old_record', case when tg_op = 'UPDATE' then row_to_json(old) end)::text);
        return new;
      end $f$;
      drop trigger if exists px_test_realtime on public.invitations;
      create trigger px_test_realtime after insert or update on public.invitations
        for each row execute function public.px_test_realtime_notify();`).catch(() => {});
    await listener.query('listen px_realtime');
    listener.on('notification', (n) => {
      const change = JSON.parse(n.payload);
      for (const sub of subs) {
        // RLS: invitations are readable only by their sender.
        if (!sub.participantId || change.record.sender_id !== sub.participantId) continue;
        const ids = sub.bindings
          .filter((b) => b.table === change.table && (b.event === '*' || b.event === change.type) && matches(b.filter, change.record))
          .map((b) => b.id);
        if (!ids.length) continue;
        sendMsg(sub.ws, sub.joinRef, null, sub.topic, 'postgres_changes', {
          ids,
          data: {
            schema: 'public', table: change.table, commit_timestamp: new Date().toISOString(), type: change.type,
            record: change.record, old_record: change.old_record ?? {},
            columns: Object.keys(change.record).map((name) => ({ name, type: 'text' })), errors: null,
          },
        });
      }
    });
  })();

  return new Promise((resolve) =>
    server.listen(port, async () => {
      await realtimeReady;
      resolve({ server, pool, close: async () => { wss.close(); server.close(); await listener.end(); return pool.end(); } });
    }),
  );
}
