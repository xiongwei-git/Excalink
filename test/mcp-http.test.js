import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureMcp } from '../src/mcp-http.js';

test('remote MCP requires a scoped key and rejects revoked sessions', async t => {
  const previousMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'password';
  const dataDir = await mkdtemp(join(tmpdir(), 'excalink-http-test-'));
  const app = express();
  app.use(express.json());
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const origin = 'http://127.0.0.1:' + listener.address().port;
  const endpoint = new URL('/mcp', origin);
  const admin = origin + '/api/settings/mcp';
  const client = new Client({ name: 'key-test', version: '1' });
  t.after(async () => {
    await client.close();
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousMode;
  });

  await configureMcp(app, {
    origin, dataDir,
    owner: req => req.get('x-test-owner') === 'yes',
    board: method => {
      assert.equal(method, 'GET');
      return { generation: '3a27baac-5d92-42c8-a6d2-126df6983223', revision: 1, scene: { elements: [], appState: {}, files: {} } };
    },
  });

  app.get('/api/mcp/current', (_req, res) => res.json({ ok: true }));
  app.put('/api/mcp/current', (_req, res) => res.json({ ok: true }));
  assert.equal((await fetch(admin)).status, 401);
  assert.equal((await fetch(endpoint)).status, 401);
  const ownerHeaders = { 'x-test-owner': 'yes', 'Content-Type': 'application/json' };
  const issued = await fetch(admin + '/keys', { method: 'POST', headers: ownerHeaders,
    body: JSON.stringify({ name: 'Reader', scope: 'read', days: 30 }) });
  assert.equal(issued.status, 201);
  const { key, token } = await issued.json();
  const headers = { Authorization: 'Bearer ' + token };
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.equal(tools.length, 27);
  for (const name of ['describe_scene', 'create_from_mermaid', 'export_to_image', 'get_canvas_screenshot']) {
    assert.ok(tools.includes(name));
  }
  assert.equal(Boolean((await client.callTool({ name: 'describe_scene' })).isError), false);
  const denied = await client.callTool({ name: 'create_element', arguments: { type: 'rectangle', x: 1, y: 1 } });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /仅允许读取/);
  const conversion = await client.callTool({
    name: 'create_from_mermaid', arguments: { mermaidDiagram: 'flowchart LR\n A --> B' },
  });
  assert.equal(conversion.isError, true);
  assert.match(conversion.content[0].text, /仅允许读取/);
  const activity = await (await fetch(admin, { headers: ownerHeaders })).json();
  assert.deepEqual(activity.records.map(({ operation, ok }) => [operation, ok]), [
    ['create_from_mermaid', false], ['create_element', false], ['describe_scene', true],
  ]);
  assert.equal(JSON.stringify(activity).includes(token), false);

  assert.equal((await fetch(admin + '/keys/' + key.id, { method: 'DELETE', headers: ownerHeaders })).status, 200);
  assert.equal((await fetch(endpoint, { headers: { ...headers, 'Mcp-Session-Id': transport.sessionId } })).status, 401);
  const issueStdio = () => fetch(admin + '/keys', { method: 'POST', headers: ownerHeaders,
    body: JSON.stringify({ name: 'Local reader', transport: 'stdio', scope: 'read', days: 30 }) });
  const attempts = await Promise.all([issueStdio(), issueStdio()]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [201, 409]);
  const createdStdio = attempts.find(response => response.status === 201);
  const stdio = await createdStdio.json();
  const stdioHeaders = { Authorization: 'Bearer ' + stdio.token };
  const boardUrl = origin + '/api/mcp/current';
  assert.equal((await fetch(endpoint, { headers: stdioHeaders })).status, 401);
  assert.equal((await fetch(boardUrl, { headers })).status, 401);
  assert.equal((await fetch(boardUrl, { headers: stdioHeaders })).status, 200);
  assert.equal((await fetch(boardUrl, { method: 'PUT', headers: stdioHeaders })).status, 403);
  const legacyHeaders = { Authorization: 'Bearer ' + 'legacy-test-token-'.repeat(3) };
  assert.equal((await fetch(boardUrl, { method: 'PUT', headers: legacyHeaders })).status, 401);
  const adminState = await (await fetch(admin, { headers: ownerHeaders })).json();
  assert.equal(adminState.keys[0].transport, 'stdio');
  assert.deepEqual(adminState.records.filter(item => item.transport === 'stdio').map(({ operation, ok }) => [operation, ok]), [
    ['保存当前白板', false], ['读取当前白板', true],
  ]);
  assert.equal((await fetch(admin + '/keys/' + stdio.key.id, { method: 'DELETE', headers: ownerHeaders })).status, 200);
  assert.equal((await fetch(boardUrl, { headers: stdioHeaders })).status, 401);
  assert.equal((await issueStdio()).status, 201);
});

test('OAuth authorizes an MCP client, rotates refresh tokens and revokes the grant', async t => {
  const previousMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'password';
  const dataDir = await mkdtemp(join(tmpdir(), 'excalink-oauth-test-'));
  const app = express();
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const origin = 'http://127.0.0.1:' + listener.address().port;
  const endpoint = new URL('/mcp', origin);
  const admin = origin + '/api/settings/mcp';
  const ownerHeaders = { 'x-test-owner': 'yes' };
  const client = new Client({ name: 'oauth-test', version: '1' });
  t.after(async () => {
    await client.close();
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousMode;
  });
  await configureMcp(app, {
    origin, dataDir,
    owner: req => req.get('x-test-owner') === 'yes',
    board: () => ({ generation: '3a27baac-5d92-42c8-a6d2-126df6983223', revision: 1,
      scene: { elements: [], appState: {}, files: {} } }),
  });
  const unauthorized = await fetch(endpoint);
  assert.equal(unauthorized.status, 401);
  const metadataUrl = unauthorized.headers.get('www-authenticate').match(/resource_metadata="([^"]+)"/)[1];
  const metadata = await (await fetch(metadataUrl)).json();
  assert.equal(metadata.resource, endpoint.href);

  const redirectUri = 'http://127.0.0.1:45678/callback';
  const registration = await fetch(origin + '/register', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'OAuth regression', redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none' }) });
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json();
  const verifier = 'v'.repeat(43);
  const query = new URLSearchParams({
    client_id, redirect_uri: redirectUri, response_type: 'code', resource: endpoint.href,
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: 'test-state',
  });
  const authorization = await fetch(origin + '/authorize?' + query, { redirect: 'manual' });
  const consent = new URL(authorization.headers.get('location'), origin);
  assert.equal((await fetch(consent, { redirect: 'manual' })).status, 302);
  const en = await fetch(new URL('?lang=en', consent), {
    headers: { ...ownerHeaders, 'Accept-Language': 'zh-CN' },
  });
  assert.equal(en.headers.get('content-language'), 'en');
  assert.match(await en.text(), /<html lang="en">.*Authorize whiteboard access/s);
  const cookie = en.headers.get('set-cookie').split(';')[0];
  const remembered = await fetch(consent, {
    headers: { ...ownerHeaders, 'Accept-Language': 'zh-CN', Cookie: cookie },
  });
  assert.equal(remembered.headers.get('content-language'), 'en');
  const zh = await fetch(consent, { headers: { ...ownerHeaders, 'Accept-Language': 'zh-CN' } });
  assert.equal(zh.headers.get('content-language'), 'zh-CN');
  const html = await zh.text();
  assert.match(html, /<html lang="zh-CN">.*授权连接白板/s);
  const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  const submit = (fields, headers = ownerHeaders) => fetch(consent, { method: 'POST', headers,
    body: new URLSearchParams({ decision: 'allow', scope: 'read', ...fields }), redirect: 'manual' });
  assert.equal((await submit({})).status, 403);
  assert.equal((await submit({ csrf }, {})).status, 403);
  const approved = await submit({ csrf });
  assert.equal(approved.status, 303);
  const callback = new URL(approved.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), 'test-state');
  const code = callback.searchParams.get('code');
  const tokenRequest = fields => fetch(origin + '/token', { method: 'POST', body: new URLSearchParams({
    client_id, resource: endpoint.href, ...fields,
  }) });
  const exchange = { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier };
  assert.equal((await tokenRequest({ ...exchange, code_verifier: 'x'.repeat(43) })).status, 400);
  const issued = await tokenRequest(exchange);
  assert.equal(issued.status, 200);
  const tokens = await issued.json();
  assert.equal((await tokenRequest(exchange)).status, 400);

  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: {
    headers: { Authorization: 'Bearer ' + tokens.access_token },
  } });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 27);
  assert.equal(Boolean((await client.callTool({ name: 'describe_scene' })).isError), false);
  assert.equal((await client.callTool({ name: 'create_element', arguments: { type: 'rectangle', x: 1, y: 1 } })).isError, true);

  const refresh = { grant_type: 'refresh_token', refresh_token: tokens.refresh_token };
  assert.equal((await tokenRequest({ ...refresh, scope: 'write' })).status, 400);
  const refreshed = await tokenRequest(refresh);
  assert.equal(refreshed.status, 200);
  const replacement = await refreshed.json();
  assert.equal((await tokenRequest(refresh)).status, 400);
  const credentials = await (await fetch(admin, { headers: ownerHeaders })).json();
  assert.equal(credentials.keys[0].oauth, true);
  assert.equal(JSON.stringify(credentials).includes(replacement.refresh_token), false);
  assert.equal((await fetch(admin + '/keys/' + credentials.keys[0].id, { method: 'DELETE', headers: ownerHeaders })).status, 200);
  assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer ' + replacement.access_token } })).status, 401);
  assert.equal((await tokenRequest({ ...refresh, refresh_token: replacement.refresh_token })).status, 400);
});
