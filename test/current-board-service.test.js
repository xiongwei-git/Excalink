import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore } from '../src/store.js';
import { CurrentBoardService } from '../src/current-board-service.js';
test('MCP facade refuses saved document addressing', async () => {
 const store = await new BoardStore(await mkdtemp(join(tmpdir(), 'whiteboard-mcp-test-'))).init();
 const service = new CurrentBoardService(store);
 for (const key of ['boardId', 'documentId', 'path']) {
   await assert.rejects(service.replace({ ...service.read(), [key]: 'anything' }), /仅允许/);
 }
});
