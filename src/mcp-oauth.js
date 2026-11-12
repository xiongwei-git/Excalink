import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { randomToken } from './auth.js';
import { isLocale, localeNames, preferredLocale, savedLocale, translator } from './locale.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const accessSeconds = 3600;
const grantMs = 90 * 86_400_000;
const active = item => item && item.expires > Date.now();
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function allowedRedirect(value) {
  const url = new URL(value);
  return !url.hash && !url.username && !url.password &&
    (url.protocol === 'https:' || (url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}

export async function configureMcpOAuth(app, { origin, dataDir, owner }) {
  const file = join(dataDir, 'mcp-oauth.json');
  let store = await readFile(file, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { clients: [], grants: [] };
    throw error;
  });
  let queue = Promise.resolve();
  const flows = new Map();
  const codes = new Map();
  const access = new Map();
  const resource = origin + '/mcp';
  const scopes = ['read', 'write'];

  function update(change) {
    const operation = queue.then(async () => {
      const next = structuredClone(store);
      next.grants = next.grants.filter(active);
      const result = change(next);
      await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await rename(file + '.tmp', file);
      store = next;
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  function checkResource(url) {
    if (url && url.href !== resource) throw new InvalidGrantError('Invalid resource');
  }

  function tokens(grant, refresh) {
    const token = randomToken();
    access.set(digest(token), { id: grant.id, expires: Date.now() + accessSeconds * 1000 });
    return { token_type: 'Bearer', access_token: token, refresh_token: refresh,
      expires_in: accessSeconds, scope: grant.scope };
  }

  function codeFor(client, code) {
    const entry = codes.get(digest(code));
    if (!active(entry) || entry.client !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return entry;
  }

  const provider = {
    clientsStore: {
      getClient: id => store.clients.find(client => client.client_id === id),
      registerClient: client => {
        if (client.token_endpoint_auth_method !== 'none' || !client.redirect_uris.length ||
            client.redirect_uris.length > 5 || !client.redirect_uris.every(allowedRedirect)) {
          throw new InvalidClientMetadataError('Use a public client with HTTPS or loopback redirect URIs');
        }
        return update(next => {
          const entry = { client_id: client.client_id, client_id_issued_at: client.client_id_issued_at,
            client_name: client.client_name?.slice(0, 100), redirect_uris: client.redirect_uris,
            token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'] };
          next.clients = next.clients.filter(item => Date.now() - item.client_id_issued_at * 1000 < grantMs ||
            next.grants.some(grant => grant.client === item.client_id));
          if (next.clients.length >= 1000) throw new InvalidClientMetadataError('Client registration capacity reached');
          next.clients.push(entry);
          return entry;
        });
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource);
      if (!/^[\w-]{43}$/.test(params.codeChallenge)) throw new InvalidGrantError('Invalid PKCE challenge');
      if (params.scopes?.some(scope => !scopes.includes(scope))) throw new InvalidScopeError('Invalid scope');
      if (flows.size >= 500) return res.sendStatus(429);
      const id = randomToken();
      flows.set(id, { client, params, csrf: randomToken(), expires: Date.now() + 10 * 60_000 });
      res.redirect('/mcp/oauth/' + id);
    },
    async challengeForAuthorizationCode(client, code) {
      return codeFor(client, code).challenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirect, url) {
      checkResource(url);
      const entry = codeFor(client, code);
      if (entry.redirect !== redirect) throw new InvalidGrantError('Invalid redirect URI');
      codes.delete(digest(code));
      const refresh = randomToken();
      const grant = await update(next => {
        if (next.grants.length >= 100) throw new InvalidGrantError('Authorization capacity reached');
        const item = { id: randomUUID(), client: client.client_id, name: entry.name,
          scope: entry.scope, expires: Date.now() + grantMs, refresh: digest(refresh) };
        next.grants.push(item);
        return item;
      });
      return tokens(grant, refresh);
    },
    async exchangeRefreshToken(client, token, requested, url) {
      checkResource(url);
      const refresh = randomToken();
      const grant = await update(next => {
        const item = next.grants.find(grant => grant.client === client.client_id && grant.refresh === digest(token));
        if (!item) throw new InvalidGrantError('Invalid refresh token');
        if (requested?.some(scope => scope !== item.scope)) throw new InvalidScopeError('Invalid scope');
        item.refresh = digest(refresh);
        return item;
      });
      return tokens(grant, refresh);
    },
    async revokeToken(client, { token }) {
      const hash = digest(token);
      await update(next => {
        next.grants = next.grants.filter(item => item.client !== client.client_id ||
          (item.refresh !== hash && access.get(hash)?.id !== item.id));
      });
    },
  };

  function keyFor(id) {
    const grant = store.grants.find(item => item.id === id && active(item));
    if (grant) return { id, name: grant.name, scope: grant.scope, transport: 'http',
      expiresAt: new Date(grant.expires).toISOString(), oauth: true };
  }

  app.get('/mcp/oauth-style.css', (_req, res) => {
    res.type('css').sendFile(fileURLToPath(new URL('./mcp-oauth.css', import.meta.url)));
  });
  app.get('/mcp/oauth-tokens.css', (_req, res) => {
    res.type('css').sendFile(fileURLToPath(new URL('./tokens.css', import.meta.url)));
  });
  app.use('/mcp/oauth/:flowId', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy':
      "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
    const requestedLocale = req.query.lang;
    req.locale = isLocale(requestedLocale) ? requestedLocale
      : savedLocale(req.get('cookie')) || preferredLocale(req.acceptsLanguages());
    const flow = flows.get(req.params.flowId);
    if (!active(flow)) {
      return res.status(410).set('Content-Language', req.locale).type('text').send(
        translator(req.locale)('授权请求已过期，请回到客户端重新连接。'),
      );
    }
    req.oauthFlow = flow;
    next();
  });
  app.get('/mcp/oauth/:flowId', (req, res) => {
    if (!owner(req)) return res.redirect('/?mcp_login=' + req.params.flowId);
    const { client, params } = req.oauthFlow;
    const { locale } = req;
    const t = translator(locale);
    const nextLocale = locale === 'en' ? 'zh-CN' : 'en';
    const [beforeClient, afterClient] = t('客户端 {client} 请求访问当前白板。').split('{client}');
    const clientName = escape(client.client_name || t('未命名客户端'));
    const readOnly = params.scopes?.length && !params.scopes.includes('write');
    if (isLocale(req.query.lang)) {
      res.cookie('excalink_locale', locale, { maxAge: 365 * 86_400_000, sameSite: 'lax',
        secure: new URL(origin).protocol === 'https:' });
    }
    res.set('Content-Language', locale).type('html').send(`<!doctype html><html lang="${locale}"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1"><title>${t('授权连接 Excalink')}</title>
      <link rel="stylesheet" href="/mcp/oauth-tokens.css"><link rel="stylesheet" href="/mcp/oauth-style.css">
      <main><header><p class="brand">Excalink</p><a href="?lang=${nextLocale}" lang="${nextLocale}">${localeNames[nextLocale]}</a></header>
      <h1>${t('授权连接白板')}</h1>
      <p>${beforeClient}<strong>${clientName}</strong>${afterClient}</p>
      <p>${t('请确认这是你刚刚发起的连接。授权有效期为 90 天，可在 MCP 服务的安全授权中撤销。')}</p>
      <form method="post"><input type="hidden" name="csrf" value="${req.oauthFlow.csrf}"><fieldset><legend>${t('访问权限')}</legend>
      <label><input name="scope" type="radio" value="read"${readOnly ? ' checked' : ''}>${t('只读，可读取和导出白板')}</label>
      ${readOnly ? '' : `<label><input name="scope" type="radio" value="write" checked>${t('读写，可创建和修改图形')}</label>`}
      </fieldset><div class="actions"><button name="decision" value="deny">${t('取消')}</button>
      <button class="primary" name="decision" value="allow">${t('授权连接')}</button></div></form></main></html>`);
  });
  app.post('/mcp/oauth/:flowId', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const { client, params, csrf } = req.oauthFlow;
    const submitted = req.body || {};
    if (!owner(req) || submitted.csrf !== csrf) return res.sendStatus(403);
    const { decision, scope } = submitted;
    if (!['allow', 'deny'].includes(decision)) return res.sendStatus(400);
    if (decision === 'allow' && (!scopes.includes(scope) ||
        (scope === 'write' && params.scopes?.length && !params.scopes.includes(scope)))) return res.sendStatus(400);
    flows.delete(req.params.flowId);
    const redirect = new URL(params.redirectUri);
    if (params.state !== undefined) redirect.searchParams.set('state', params.state);
    if (decision === 'deny') {
      redirect.searchParams.set('error', 'access_denied');
    } else {
      const code = randomToken();
      codes.set(digest(code), { client: client.client_id, name: client.client_name || 'OAuth 客户端',
        scope, challenge: params.codeChallenge, redirect: params.redirectUri, expires: Date.now() + 60_000 });
      redirect.searchParams.set('code', code);
    }
    res.redirect(303, redirect.href);
  });
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(origin), resourceServerUrl: new URL(resource),
    scopesSupported: scopes, resourceName: 'Excalink' }));
  const cleanup = setInterval(() => {
    for (const entries of [flows, codes, access]) {
      for (const [id, entry] of entries) if (!active(entry)) entries.delete(id);
    }
  }, 60_000);
  cleanup.unref();

  return {
    keyFor,
    findKey(header) {
      const token = /^Bearer ([\w-]{43})$/i.exec(header)?.[1];
      const entry = token && access.get(digest(token));
      if (active(entry)) return keyFor(entry.id);
    },
    keys: () => store.grants.map(grant => keyFor(grant.id)).filter(Boolean),
    remove: id => store.grants.some(grant => grant.id === id) &&
      update(next => { next.grants = next.grants.filter(grant => grant.id !== id); }),
  };
}
