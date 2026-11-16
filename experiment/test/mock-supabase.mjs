// Local stand-in for the two Supabase services the app talks to:
//   * GoTrue email OTP / magic link (/auth/v1/*)
//   * PostgREST RPC (/rest/v1/rpc/:fn) — executed against a real Postgres with
//     the same role switching + JWT claims PostgREST uses, so RLS and
//     SECURITY DEFINER behave exactly as in production.
// Test-only helpers live under /__test/*.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

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
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.raw_user_meta_data,
    created_at: u.created_at,
    updated_at: u.created_at,
  });

  const session = (u) => {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJwt({
      sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp: now + 3600, iat: now,
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
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
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
      if (url.pathname === '/auth/v1/verify' && req.method === 'POST') {
        const email = String(body.email).toLowerCase();
        const entry = codes.get(email);
        if (!entry || entry.code !== String(body.token)) {
          return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        }
        codes.delete(email);
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
          const r = await client.query(`select public.${m[1]}(${args}) as result`, keys.map((k) => body[k]));
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
      if (url.pathname === '/__test/code') {
        return send(200, codes.get(url.searchParams.get('email')) ?? null);
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

  return new Promise((resolve) =>
    server.listen(port, () => resolve({ server, pool, close: () => { server.close(); return pool.end(); } })),
  );
}
