import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated Compose project: never touches the normal service or its data volume.
const project = `excalink-check-${Date.now()}`;
const port = process.env.EXCALINK_TEST_PORT || '14873';
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, EXCALINK_PORT: port, APP_ORIGIN: origin,
  AUTH_MODE: 'public', MCP_TOKEN: '' };
function compose(...args) {
  return execFileSync('docker', ['compose', '-p', project, ...args], { env, encoding: 'utf8' });
}
async function request(path, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
}
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return await request('/api/current'); } catch { await delay(500); }
  }
  throw new Error('Container did not become ready');
}
try {
  compose('up', '-d', '--no-build');
  const initial = await ready();
  assert.equal(initial.scene.elements.length, 0);
  assert.equal((await fetch(origin)).status, 200);
  assert.equal(compose('exec', '-T', 'whiteboard', 'id', '-un').trim(), 'node');
  const scene = { elements: [{ id: 'docker-smoke', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }],
    appState: {}, files: {} };
  const saved = await request('/api/current', 'PUT', { ...initial, scene });
  const archive = await request('/api/current/save', 'POST', saved);
  compose('up', '-d', '--no-build', '--force-recreate');
  assert.deepEqual((await ready()).scene, scene);
  assert.deepEqual((await request(`/api/boards/${archive.id}`)).scene, scene);
  console.log('PASS: container HTTP, non-root user, current board and archive survive recreation');
} finally {
  // Only the synthetic project and volume created above are removed.
  compose('down', '-v');
}
