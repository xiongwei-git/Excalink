import express from 'express';
import { WebSocketServer } from 'ws';
import { resolve } from 'node:path';
import { BoardStore, Conflict } from './store.js';
import { CurrentBoardService } from './current-board-service.js';
import { configureMcp } from './mcp-http.js';
import { configureAuth } from './auth.js';

const port = Number(process.env.PORT || 4173);
const origin = new URL(process.env.APP_ORIGIN || `http://127.0.0.1:${port}`).origin;
const host = new URL(origin).host;
const localHost = host === `127.0.0.1:${port}` ? `localhost:${port}` : null;
const dataDir = resolve(process.env.BOARD_DATA_DIR || 'data');
const store = await new BoardStore(dataDir).init();
const current = new CurrentBoardService(store);
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.headers.host !== host && req.headers.host !== localHost) return res.sendStatus(403);
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(['/api', '/auth'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const supplied = req.get('origin');
  if (req.get('sec-fetch-site') === 'cross-site' && req.method !== 'GET' ||
      supplied && supplied !== origin && !(host === `127.0.0.1:${port}` && supplied === `http://localhost:${port}`)) {
    return res.status(403).json({ error: '请从白板页面发起此操作。' });
  }
  next();
});
app.use(['/api', '/auth'], express.json({ limit: '21mb' }));
const owner = await configureAuth(app, origin);
const rooms = new Map();
const publicScene = ({ share: _share, ...board }) => board;
const shareRoom = token => 'share:' + token;

function send(socket, event) {
  if (socket.bufferedAmount > 24 * 1024 * 1024) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(event));
}

function broadcast(key, board) {
  for (const { socket, authorized } of rooms.get(key) || []) {
    if (socket.readyState !== 1) continue;
    if (!authorized()) {
      send(socket, { type: 'revoked' });
      socket.close(1008);
    } else {
      send(socket, { type: 'board', board: publicScene(board) });
    }
  }
}

function broadcastBoard(board) {
  broadcast(board.id || 'current', board);
  if (board.share) broadcast(shareRoom(board.share), board);
}

function closePreviousShare({ board, previous }) {
  if (previous && previous !== board.share) broadcast(shareRoom(previous), board);
  return board;
}

function joinRoom(socket, key, board, authorized) {
  const room = rooms.get(key) || new Set();
  rooms.set(key, room);
  const entry = { socket, authorized };
  room.add(entry);
  let alive = true;
  socket.on('pong', () => { alive = true; });
  socket.on('message', data => {
    if (key !== 'current' || !authorized()) return socket.close(1008);
    try {
      const message = JSON.parse(data);
      if (message.type !== 'selection' || !Array.isArray(message.ids) || message.ids.length > 100 ||
          message.ids.some(id => typeof id !== 'string' || id.length > 100)) return socket.close(1008);
      entry.selection = { generation: message.generation, ids: message.ids, updated: Date.now() };
    } catch {
      socket.close(1008);
    }
  });
  socket.on('error', () => socket.terminate());
  send(socket, { type: 'board', board: publicScene(board) });
  const timer = setInterval(() => {
    if (!alive) return socket.terminate();
    if (!authorized()) {
      send(socket, { type: 'revoked' });
      return socket.close(1008);
    }
    alive = false;
    socket.ping();
  }, 15_000);
  socket.on('close', () => {
    clearInterval(timer);
    room.delete(entry);
    if (!room.size) rooms.delete(key);
  });
}

function getSelection() {
  const { generation, scene } = current.read();
  const newest = [...(rooms.get('current') || [])].filter(entry =>
    entry.authorized() && entry.selection?.generation === generation)
    .sort((a, b) => b.selection.updated - a.selection.updated)[0];
  const visible = new Set(scene.elements.filter(element => !element.isDeleted).map(element => element.id));
  const selectedElementIds = (newest?.selection.ids || []).filter(id => visible.has(id));
  return { selectedElementIds, count: selectedElementIds.length };
}
function setViewport(body) {
  const { generation, revision, viewport } = body || {};
  const snapshot = current.read();
  if (generation !== snapshot.generation || revision !== snapshot.revision) throw new Conflict();
  if (!viewport || typeof viewport !== 'object') return null;
  let clients = 0;
  for (const entry of rooms.get('current') || []) {
    if (entry.authorized() && entry.socket.readyState === 1) {
      send(entry.socket, { type: 'viewport', generation, viewport });
      clients++;
    }
  }
  return { delivered: clients };
}
async function replaceCurrent(body) {
  const board = await current.replace(body);
  broadcastBoard(board);
  return publicScene(board);
}
await configureMcp(app, {
  origin, dataDir, owner,
  board(method, body, suffix) {
    if (suffix === '/selection') return getSelection();
    if (suffix === '/viewport') {
      const result = setViewport(body);
      if (!result) throw new Error('视口参数无效。');
      if (!result.delivered) throw new Error('请先打开当前白板，再设置视口。');
      return result;
    }
    if (method === 'PUT') return replaceCurrent(body);
    return current.read();
  },
});
app.get('/api/mcp/current', (_req, res) => res.json(current.read()));
app.get('/api/mcp/current/selection', (_req, res) => res.json(getSelection()));
app.post('/api/mcp/current/viewport', (req, res) => {
  const result = setViewport(req.body);
  if (!result) return res.sendStatus(400);
  if (!result.delivered) return res.status(409).json({ error: '请先打开当前白板，再设置视口。' });
  res.json(result);
});
app.put('/api/mcp/current', async (req, res) => res.json(await replaceCurrent(req.body)));

app.param('token', (req, res, next, token) => {
  const board = /^[\w-]{43}$/.test(token) && store.byShare(token);
  if (!board) return res.status(404).json({ error: '分享链接已撤销或不存在。' });
  req.shared = board;
  next();
});
app.get('/api/share/:token', (req, res) => res.json(publicScene(req.shared)));
app.patch('/api/share/:token', async (req, res) => {
  const { generation, revision, scene } = req.body || {};
  if (!scene) return res.status(400).json({ error: '缺少画布内容。' });
  const board = await store.updateShared(req.params.token, { generation, revision, scene });
  broadcastBoard(board);
  res.json(publicScene(board));
});

app.use('/api', (req, res, next) => owner(req) ? next() : res.status(401).json({ error: '请先登录。' }));
app.get('/api/current', (_req, res) => res.json(store.current()));
app.put('/api/current', async (req, res) => {
  const board = await store.updateCurrent(req.body);
  broadcastBoard(board);
  res.json(board);
});
app.post('/api/current/save', async (req, res) => res.status(201).json(await store.saveCurrent(req.body)));
app.post('/api/current/share', async (req, res) => {
  if (req.body?.enabled !== undefined && typeof req.body.enabled !== 'boolean') return res.sendStatus(400);
  const result = await store.shareCurrent(req.body || {});
  res.json(closePreviousShare(result));
});
app.post('/api/current/new', async (req, res) => {
  const result = await store.newCurrent(req.body);
  if (result.archived?.share) broadcast(shareRoom(result.archived.share), result.archived);
  broadcastBoard(result.current);
  res.json(result);
});
app.get('/api/boards', (_req, res) => res.json(store.list()));
app.param('id', (req, res, next, id) => {
  if (!/^[a-f0-9-]{36}$/.test(id) || !store.list().some(board => board.id === id)) {
    return res.status(404).json({ error: '未找到此白板。' });
  }
  next();
});
app.get('/api/boards/:id', (req, res) => res.json(store.board(req.params.id)));
app.patch('/api/boards/:id', async (req, res) => {
  const board = await store.updateBoard(req.params.id, req.body);
  broadcastBoard(board);
  res.json(board);
});
app.delete('/api/boards/:id', async (req, res) => {
  if (!Number.isSafeInteger(req.body?.revision)) return res.sendStatus(400);
  const board = await store.deleteBoard(req.params.id, req.body.revision);
  broadcastBoard(board);
  res.json({ deleted: true });
});
app.put('/api/boards/:id/share', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.sendStatus(400);
  const result = await store.shareBoard(req.params.id, req.body.enabled);
  res.json(closePreviousShare(result));
});
app.use('/api', (_req, res) => res.status(404).json({ error: '未找到请求的内容。' }));
app.use(express.static(resolve('dist')));
app.get(['/boards/:id', '/share/:link'], (_req, res) => res.sendFile(resolve('dist/index.html')));
app.use((error, _req, res, _next) => {
  if (error instanceof Conflict) return res.status(409).json({ error: error.message });
  if (error.status === 404) return res.status(404).json({ error: '未找到此白板。' });
  if (error.status === 403) return res.status(403).json({ error: '分享权限已撤销。' });
  if (error.status === 413 || error.message === 'Scene exceeds 20MB') {
    return res.status(413).json({ error: '白板超过 20 MB，请减少图片后再保存。' });
  }
  if (error.status === 400 || ['Invalid name', 'Invalid scene'].includes(error.message)) {
    return res.status(400).json({ error: '请检查白板内容或名称。' });
  }
  res.status(500).json({ error: '服务暂时不可用，请稍后重试。' });
});
const listener = app.listen(port, process.env.BIND_HOST || '127.0.0.1', () => console.log(`白板服务监听端口 ${port}`));

const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
listener.on('upgrade', (req, socket, head) => {
  const reject = () => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  const suppliedHost = req.headers.host;
  const expectedOrigin = suppliedHost === host ? origin : localHost && suppliedHost === localHost ? `http://${localHost}` : null;
  if (!expectedOrigin || req.headers.origin !== expectedOrigin || sockets.clients.size >= 64) return reject();
  const pathname = req.url?.split('?')[0];
  const token = /^\/api\/share\/([\w-]{43})\/events$/.exec(pathname)?.[1];
  const id = /^\/api\/boards\/([a-f0-9-]{36})\/events$/.exec(pathname)?.[1];
  let key;
  let board;
  let authorized = () => owner(req);
  if (token) {
    board = store.byShare(token);
    if (!board) return reject();
    key = shareRoom(token);
    authorized = () => store.hasShare(token);
  } else if (id && store.list().some(item => item.id === id)) {
    key = id;
    board = store.board(id);
    authorized = () => owner(req) && store.list().some(item => item.id === id);
  } else if (pathname === '/api/current/events') {
    key = 'current';
    board = store.current();
  } else return reject();
  if (!authorized()) return reject();
  sockets.handleUpgrade(req, socket, head, client => joinRoom(client, key, board, authorized));
});
