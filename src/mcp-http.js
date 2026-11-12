import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createBoardMcp } from './board-mcp.js';
import { configureMcpOAuth } from './mcp-oauth.js';
import { renderInBrowser } from './mcp-render.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const keyInfo = ({ digest, ...key }) => key;
const idleMs = 30 * 60_000;

export async function configureMcp(app, { origin, dataDir, owner, board }) {
  const url = new URL(origin);
  const privateBoard = ['password', 'oidc'].includes(process.env.AUTH_MODE);
  const secureOrigin = url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const enabled = privateBoard && secureOrigin;
  const file = join(dataDir, 'mcp-keys.json');
  let keys = enabled ? await readFile(file, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  }) : [];
  const oauth = enabled && (url.protocol === 'https:' || url.hostname !== '[::1]')
    ? await configureMcpOAuth(app, { origin, dataDir, owner }) : null;
  const sessions = new Map();
  const activity = { http: [], stdio: [] };
  const keyTransport = key => key.transport ?? 'http';
  const latestStdio = keys.findLast(key => keyTransport(key) === 'stdio');
  keys = keys.filter(key => keyTransport(key) !== 'stdio' || key === latestStdio);

  function findKey(header, transport) {
    if (!enabled || !/^Bearer excalink_[\w-]{43}$/.test(header)) return;
    const digest = hash(header.slice(7));
    return keys.find(key => keyTransport(key) === transport && key.digest === digest && Date.parse(key.expiresAt) > Date.now());
  }

  app.use('/api/mcp', (req, res, next) => {
    const key = findKey(req.get('authorization') || '', 'stdio');
    if (!key) return res.status(401).json({ error: 'MCP 令牌无效。' });
    const operation = {
      'GET /current': '读取当前白板',
      'PUT /current': '保存当前白板',
      'GET /current/selection': '读取选区',
      'POST /current/viewport': '设置视口',
    }[(req.method === 'HEAD' ? 'GET' : req.method) + ' ' + req.path.replace(/\/$/, '')];
    if (operation) {
      const start = performance.now();
      res.once('finish', () => record('stdio', key, operation, res.statusCode < 400, Math.round(performance.now() - start)));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && key.scope !== 'write') {
      return res.status(403).json({ error: '此访问令牌仅允许读取。' });
    }
    next();
  });
  let pending = Promise.resolve();
  let activeRenders = 0;
  const rendererAssets = resolve('dist');

  function update(change) {
    const operation = pending.then(async () => {
      const next = change(keys);
      await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await rename(file + '.tmp', file);
      keys = next;
    });
    pending = operation.catch(() => {});
    return operation;
  }

  function record(transport, key, operation, ok, ms) {
    const records = activity[transport];
    records.unshift({ transport, id: randomUUID(), at: new Date().toISOString(), key: key.name, operation, ok, ms });
    if (records.length > 200) records.pop();
  }

  const admin = express.Router();
  admin.use((req, res, next) => owner(req) ? next() : res.status(401).json({ error: '请先登录。' }));
  admin.get('/', (_req, res) => res.json({
    enabled, oauth: Boolean(oauth), privateBoard, secureOrigin, endpoint: origin + '/mcp',
    keys: keys.map(key => ({ ...keyInfo(key), transport: keyTransport(key) })).concat(oauth?.keys() || []),
    records: [...activity.http, ...activity.stdio],
  }));
  admin.use((_req, res, next) => enabled ? next() : res.status(403).json({ error: '请先启用白板登录并配置 HTTPS。' }));
  admin.post('/keys', async (req, res) => {
    const { scope, days, transport = 'http' } = req.body || {};
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 60 || !['http', 'stdio'].includes(transport) || !['read', 'write'].includes(scope) || ![30, 90, 365].includes(days)) {
      return res.status(400).json({ error: '请填写凭据名称、权限和有效期。' });
    }
    const token = 'excalink_' + randomBytes(32).toString('base64url');
    const key = { id: randomUUID(), name, scope, transport, suffix: token.slice(-6), digest: hash(token),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() };
    try {
      await update(existing => {
        const active = existing.filter(item => Date.parse(item.expiresAt) > Date.now());
        if (transport === 'stdio' && active.some(item => keyTransport(item) === 'stdio')) {
          throw Object.assign(new Error('本地 stdio 已有有效令牌，请先撤销后再生成。'), { code: 'STDIO_TOKEN_EXISTS' });
        }
        if (active.length >= 50) throw Object.assign(new Error('最多保留 50 个有效凭据。'), { status: 400 });
        return [...active, key];
      });
    } catch (error) {
      if (error.code === 'STDIO_TOKEN_EXISTS') return res.status(409).json({ error: error.message });
      throw error;
    }
    res.status(201).json({ key: keyInfo(key), token });
  });
  admin.delete('/keys/:id', async (req, res) => {
    if (!await oauth?.remove(req.params.id)) {
      await update(existing => existing.filter(key => key.id !== req.params.id));
    }
    await Promise.allSettled([...sessions.values()].filter(session => session.key.id === req.params.id)
      .map(session => session.transport.close()));
    res.json({ ok: true });
  });
  app.use('/api/settings/mcp', admin);

  if (!enabled) return;
  const timer = setInterval(() => {
    for (const session of sessions.values()) {
      if (session.touched + idleMs < Date.now() || Date.parse(session.key.expiresAt) <= Date.now()) {
        void session.transport.close();
      }
    }
  }, 60_000);
  timer.unref();

  const rpcError = (res, status, message) => res.status(status).json({
    jsonrpc: '2.0', id: null, error: { code: -32000, message },
  });

  app.all('/mcp', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin') && req.get('origin') !== origin) return rpcError(res, 403, 'Invalid Origin');
    const header = req.get('authorization') || '';
    const key = findKey(header, 'http') || oauth?.findKey(header);
    if (!key) {
      res.set('WWW-Authenticate', oauth
        ? `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
        : 'Bearer');
      return rpcError(res, 401, 'Invalid or expired Excalink credential');
    }
    req.mcpKey = key;
    next();
  }, express.json({ limit: '21mb' }), async (req, res) => {
    const key = req.mcpKey;
    const sessionId = req.get('mcp-session-id');
    let session = sessions.get(sessionId);
    if (sessionId && session?.key.id !== key.id) return rpcError(res, 404, 'MCP session not found');
    if (!session) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        return rpcError(res, 400, 'Initialize an MCP session first');
      }
      if (sessions.size >= 50) return rpcError(res, 429, 'Too many active MCP sessions');
      const id = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => id,
        enableJsonResponse: true,
      });
      session = { transport, key, touched: Date.now() };
      sessions.set(id, session);
      transport.onclose = () => sessions.delete(id);
      function authorize(write) {
        const activeKey = key.oauth ? oauth.keyFor(key.id) : keys.includes(key);
        if (!activeKey || Date.parse(key.expiresAt) <= Date.now()) throw new Error('访问凭据已失效。');
        if (write && key.scope !== 'write') throw new Error('此访问凭据仅允许读取。');
      }
      const server = createBoardMcp({
        board: (method = 'GET', body, suffix) => {
          authorize(method !== 'GET');
          return board(method, body, suffix);
        },
        render: async payload => {
          authorize(payload.operation === 'mermaid');
          if (activeRenders >= 2) throw new Error('画布渲染繁忙，请稍后重试。');
          activeRenders++;
          try {
            const result = await renderInBrowser('https://excalink-render.invalid', payload, { assetRoot: rendererAssets });
            authorize(false);
            return result;
          } finally {
            activeRenders--;
          }
        },
        onTool: (name, ok, ms) => record('http', key, name, ok, ms),
      });
      try {
        await server.connect(transport);
      } catch (error) {
        await transport.close();
        throw error;
      }
      res.once('finish', () => {
        if (!transport.sessionId) void transport.close();
      });
    }
    session.touched = Date.now();
    await session.transport.handleRequest(req, res, req.body);
  });
}
