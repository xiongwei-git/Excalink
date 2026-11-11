import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as oidc from 'openid-client';

const derive = promisify(scrypt);
export const randomToken = () => randomBytes(32).toString('base64url');
const sessionCookie = 'pwb_session';
const pendingCookie = 'pwb_oidc';

function cookie(req, name) {
  return req.headers.cookie?.split(/;\s*/).find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}

export async function configureAuth(app, origin) {
  const mode = process.env.AUTH_MODE || 'public';
  const sessions = new Map();
  const pending = new Map();
  const secure = origin.startsWith('https:');
  const setCookie = (res, name, value, age) => res.cookie(name, value, {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: age,
  });
  function register(res) {
    const key = randomToken();
    const age = 8 * 60 * 60 * 1000;
    sessions.set(key, Date.now() + age);
    setCookie(res, sessionCookie, key, age);
  }

  const passwordHash = process.env.PASSWORD_HASH?.match(/^([a-f0-9]{32}):([a-f0-9]{128})$/i);
  if (mode === 'password' && (!passwordHash || !process.env.AUTH_USERNAME)) {
    throw new Error('password 模式需要 AUTH_USERNAME 和 PASSWORD_HASH');
  }
  let provider;
  if (mode === 'oidc') {
    const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_SUBJECT } = process.env;
    if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_SUBJECT) {
      throw new Error('oidc 模式需要 issuer、client ID、client secret 和获准的 subject');
    }
    provider = await oidc.discovery(new URL(OIDC_ISSUER), OIDC_CLIENT_ID, OIDC_CLIENT_SECRET);
    oidc.enableNonRepudiationChecks(provider);
  }
  if (!['public', 'password', 'oidc'].includes(mode)) throw new Error('未知 AUTH_MODE');
  const redirect_uri = origin + '/auth/callback';
  const attempts = new Map();

  function owner(req) {
    if (mode === 'public') return true;
    const key = cookie(req, sessionCookie);
    return (sessions.get(key) || 0) > Date.now();
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
    for (const [key, flow] of pending) if (flow.expires <= now) pending.delete(key);
    for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
  }, 60_000);
  cleanup.unref();

  app.get('/auth/session', (req, res) => res.json({ mode, owner: owner(req) }));
  app.post('/auth/password', async (req, res) => {
    if (mode !== 'password') return res.sendStatus(404);
    const key = req.ip;
    const now = Date.now();
    const prior = attempts.get(key);
    const attempt = prior?.expires > now ? prior : { count: 0, expires: now + 60_000 };
    attempts.set(key, attempt);
    if (++attempt.count > 8) return res.status(429).json({ error: '登录尝试过多，请一分钟后重试。' });
    const { username, password } = req.body || {};
    if (typeof password !== 'string' || password.length > 1024) return res.sendStatus(400);
    const hash = await derive(password, Buffer.from(passwordHash[1], 'hex'), 64);
    if (!timingSafeEqual(hash, Buffer.from(passwordHash[2], 'hex')) || username !== process.env.AUTH_USERNAME) {
      return res.status(401).json({ error: '用户名或密码有误。' });
    }
    attempts.delete(key);
    register(res);
    res.json({ owner: true });
  });
  app.get('/auth/oidc', async (_req, res) => {
    if (!provider) return res.sendStatus(404);
    const key = randomToken();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const age = 5 * 60 * 1000;
    if (pending.size >= 500) return res.sendStatus(429);
    pending.set(key, { verifier, state, nonce, expires: Date.now() + age });
    setCookie(res, pendingCookie, key, age);
    res.redirect(oidc.buildAuthorizationUrl(provider, {
      redirect_uri, scope: 'openid', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
    }).href);
  });
  app.get('/auth/callback', async (req, res) => {
    const key = cookie(req, pendingCookie);
    const flow = pending.get(key);
    pending.delete(key);
    setCookie(res, pendingCookie, '', 0);
    if (!provider || !flow || flow.expires < Date.now()) return res.redirect('/?login=failed');
    try {
      const tokens = await oidc.authorizationCodeGrant(provider, new URL(origin + req.originalUrl), {
        pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce,
      });
      if (tokens.claims()?.sub !== process.env.OIDC_SUBJECT) return res.redirect('/?login=failed');
      register(res);
      return res.redirect('/');
    } catch {
      return res.redirect('/?login=failed');
    }
  });
  app.post('/auth/logout', (req, res) => {
    sessions.delete(cookie(req, sessionCookie));
    setCookie(res, sessionCookie, '', 0);
    res.json({ owner: false });
  });
  return owner;
}
