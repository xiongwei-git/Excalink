import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore, Conflict } from '../src/store.js';
const scene = { elements: [{ id: 'a', type: 'rectangle' }], appState: {}, files: {} };
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'personal-whiteboard-test-')); return { dir, store: await new BoardStore(dir).init() }; }
test('current scene survives restart', async () => {
 const { dir, store } = await fixture(); await store.updateCurrent({ ...store.current(), scene });
 assert.deepEqual((await new BoardStore(dir).init()).current().scene, scene);
});
test('save copies current; rename keeps identity and cannot change current', async () => {
 const { store } = await fixture(); await store.updateCurrent({ ...store.current(), scene });
 const b = await store.saveCurrent(store.current());
 const r = await store.updateBoard(b.id, { revision: b.revision, name: '../../not-a-path', scene: { ...scene, elements: [] } });
 assert.equal(r.id, b.id); assert.deepEqual(store.current().scene, scene);
});
test('new archives nonempty and blocks late generation writes', async () => {
 const { store } = await fixture(); await store.updateCurrent({ ...store.current(), scene }); const old = store.current();
 const result = await store.newCurrent(old); assert.deepEqual(result.archived.scene, scene);
 await assert.rejects(store.updateCurrent({ ...old, scene }), Conflict); assert.equal(store.current().scene.elements.length, 0);
});
test('empty new does not create file', async () => { const { store } = await fixture(); await store.newCurrent(store.current()); assert.equal(store.list().length, 0); });
test('concurrent stale saves cannot overwrite', async () => {
 const { store } = await fixture(); const c = store.current();
 const results = await Promise.allSettled([store.updateCurrent({ ...c, scene }), store.updateCurrent({ ...c, scene })]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('saved board revision conflict rejects stale edits', async () => {
 const { store } = await fixture(); const b = await store.saveCurrent(store.current());
 await store.updateBoard(b.id, { revision: 0, name: 'First' });
 await assert.rejects(store.updateBoard(b.id, { revision: 0, name: 'Stale' }), Conflict);
 assert.equal(store.board(b.id).name, 'First');
});

test('archive is a standalone scene and restores images and share metadata', async () => {
 const { dir, store } = await fixture();
 const image = { id: 'image-1', type: 'image', fileId: 'file-1' };
 const files = { 'file-1': { id: 'file-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } };
 const current = await store.updateCurrent({ ...store.current(), scene: { elements: [image], appState: {}, files } });
 const { board: shared } = await store.shareCurrent(current);
 const { archived } = await store.newCurrent(current);
 assert.equal(archived.share, shared.share);
 const manifest = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
 const exported = JSON.parse(await readFile(join(dir, 'scenes', manifest.boards[archived.id].sceneFile), 'utf8'));
 assert.equal(exported.type, 'excalidraw');
 assert.deepEqual(exported.files, files);
 const reopened = await new BoardStore(dir).init();
 assert.deepEqual(reopened.byShare(archived.share).scene, current.scene);
 await reopened.shareBoard(archived.id, false);
 await assert.rejects(reopened.updateShared(archived.share, { revision: archived.revision, scene }), { status: 403 });
});

test('archive write failure leaves the current board intact', async () => {
 const { dir, store } = await fixture();
 const current = await store.updateCurrent({ ...store.current(), scene });
 await rename(join(dir, 'scenes'), join(dir, 'scenes-backup'));
 await assert.rejects(store.newCurrent(current), { code: 'ENOENT' });
 assert.deepEqual(store.current(), current);
 assert.deepEqual((await new BoardStore(dir).init()).current(), current);
 assert.equal(store.list().length, 0);
});

test('sharing keeps one current board until it becomes an archive', async () => {
 const { store } = await fixture();
 const original = store.current();
 const { board } = await store.shareCurrent(original);
 assert.equal(store.list().length, 0);
 assert.equal((await store.shareCurrent(original)).board.share, board.share);
 const guest = await store.updateShared(board.share, { ...original, scene });
 assert.equal(store.current().revision, guest.revision);
 const copy = await store.saveCurrent(guest);
 assert.equal(copy.share, undefined);
 const { archived, current } = await store.newCurrent(guest);
 assert.equal(archived.revision, guest.revision);
 assert.equal(archived.generation, guest.generation);
 assert.equal(current.share, undefined);
 await store.updateShared(board.share, { ...guest, scene: { ...scene, elements: [] } });
 assert.equal(store.board(archived.id).scene.elements.length, 0);
 assert.deepEqual(store.current(), current);
});

test('new board preserves an empty shared board and revocation invalidates its old link', async () => {
 const { store } = await fixture();
 const original = store.current();
 const { board } = await store.shareCurrent(original);
 const { archived } = await store.newCurrent(original);
 assert.equal(archived.share, board.share);
 await store.shareBoard(archived.id, false);
 assert.equal(store.byShare(board.share), undefined);
});
