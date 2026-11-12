import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export class Conflict extends Error { constructor() { super('文档版本已变化，请重新加载，当前内容未覆盖'); this.status = 409; } }
const empty = () => ({ elements: [], appState: {}, files: {} });
const clone = value => structuredClone(value);
const hasContent = scene => scene.elements.some(e => !e.isDeleted);
function validate(scene) {
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(scene) || !Array.isArray(scene.elements) || !isObject(scene.appState) || !isObject(scene.files) ||
      scene.elements.some(element => !isObject(element) || typeof element.id !== 'string' || typeof element.type !== 'string')) {
    throw new Error('Invalid scene');
  }
  if (Buffer.byteLength(JSON.stringify(scene)) > 20 * 1024 * 1024) throw new Error('Scene exceeds 20MB');
}
// One process owns this store. Whole-state atomic replacement keeps archive+reset indivisible.
export class BoardStore {
  #queue = Promise.resolve();
  constructor(directory) { this.directory = directory; this.path = join(directory, 'state.json'); }
  async init() {
    this.scenes = join(this.directory, 'scenes');
    await mkdir(this.scenes, { recursive: true, mode: 0o700 });
    this.references = new Map();
    try {
      this.state = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { current: { generation: randomUUID(), revision: 0, scene: empty() }, boards: {} };
      await this.#persist(this.state);
      return this;
    }
    for (const board of Object.values(this.state.boards)) {
      if (!board.sceneFile) continue; // Previous releases embedded archived scenes.
      if (!/^[a-f0-9-]{36}\.excalidraw$/.test(board.sceneFile)) throw new Error('Invalid scene filename');
      const { sceneFile } = board;
      const { elements, appState, files } = JSON.parse(await readFile(join(this.scenes, sceneFile), 'utf8'));
      board.scene = { elements, appState, files };
      this.references.set(board.id, { file: sceneFile, revision: board.revision });
      delete board.sceneFile;
    }
    return this;
  }
  async #write(path, content) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(content));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async #persist(state) {
    const manifest = { current: state.current, boards: {} };
    const references = new Map();
    for (const { scene, ...board } of Object.values(state.boards)) {
      let reference = this.references.get(board.id);
      if (reference?.revision !== board.revision) {
        reference = { file: `${randomUUID()}.excalidraw`, revision: board.revision };
        await this.#write(join(this.scenes, reference.file), {
          type: 'excalidraw', version: 2, source: 'personal-whiteboard', ...scene,
        });
      }
      references.set(board.id, reference);
      manifest.boards[board.id] = { ...board, sceneFile: reference.file };
    }
    // The manifest commits the current board and the set of archive versions together.
    await this.#write(this.path, manifest);
    this.references = references;
  }
  #mutate(fn) {
    const work = this.#queue.then(async () => {
      const next = clone(this.state);
      const result = fn(next);
      await this.#persist(next); // Memory is changed only after the durable replacement succeeds.
      this.state = next;
      return clone(result);
    });
    this.#queue = work.catch(() => {});
    return work;
  }
  current() { return clone(this.state.current); }
  list() { return Object.values(this.state.boards).map(({ id, name, revision }) => ({ id, name, revision })); }
  board(id) { const board = this.state.boards[id]; if (!board) throw new Error('Not found'); return clone(board); }
  updateCurrent({ generation, revision, scene }) {
    validate(scene);
    return this.#mutate(state => {
      const c = state.current;
      if (c.generation !== generation || c.revision !== revision) throw new Conflict();
      c.scene = clone(scene); c.revision++;
      return c;
    });
  }
  #archive(state) {
    const id = randomUUID();
    const b = { id, name: new Date().toISOString(), revision: 0, scene: clone(state.current.scene) };
    state.boards[id] = b;
    return b;
  }
  saveCurrent({ generation, revision }) {
    return this.#mutate(state => {
      if (state.current.generation !== generation || state.current.revision !== revision) throw new Conflict();
      return this.#archive(state);
    });
  }
  newCurrent({ generation, revision }) {
    return this.#mutate(state => {
      if (state.current.generation !== generation || state.current.revision !== revision) throw new Conflict();
      const previous = state.current;
      const archived = previous.share || hasContent(previous.scene) ? this.#archive(state) : null;
      if (previous.share) {
        Object.assign(archived, { generation: previous.generation, revision: previous.revision, share: previous.share });
      }
      state.current = { generation: randomUUID(), revision: 0, scene: empty() };
      return { archived, current: state.current };
    });
  }
  #setShare(board, enabled) {
    const previous = board.share;
    board.share = enabled ? previous || randomBytes(32).toString('base64url') : null;
    return { board, previous };
  }
  shareBoard(id, enabled) {
    return this.#mutate(state => {
      const board = state.boards[id];
      if (!board) throw new Error('Not found');
      return this.#setShare(board, enabled);
    });
  }
  shareCurrent({ generation, revision, enabled = true }) {
    return this.#mutate(state => {
      if (state.current.generation !== generation || state.current.revision !== revision) throw new Conflict();
      return this.#setShare(state.current, enabled);
    });
  }
  #findShared(state, token) {
    if (!token) return;
    if (state.current.share === token) return state.current;
    return Object.values(state.boards).find(board => board.share === token);
  }
  hasShare(token) {
    return Boolean(this.#findShared(this.state, token));
  }
  byShare(token) {
    const board = this.#findShared(this.state, token);
    return board && clone(board);
  }
  updateShared(token, { generation, revision, scene }) {
    validate(scene);
    return this.#mutate(state => {
      const board = this.#findShared(state, token);
      if (!board) throw Object.assign(new Error('Share revoked'), { status: 403 });
      if (board.revision !== revision || (generation !== undefined && board.generation !== generation)) throw new Conflict();
      board.scene = clone(scene);
      board.revision++;
      return board;
    });
  }
  deleteBoard(id, revision) {
    return this.#mutate(state => {
      const board = state.boards[id];
      if (!board) throw Object.assign(new Error('Board not found'), { status: 404 });
      if (board.revision !== revision) throw new Conflict();
      delete state.boards[id];
      return board;
    });
  }
  updateBoard(id, { revision, scene, name }) {
    if (scene !== undefined) validate(scene);
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('Invalid name');
    return this.#mutate(state => {
      const board = state.boards[id];
      if (!board) throw new Error('Not found');
      if (board.revision !== revision) throw new Conflict();
      if (scene !== undefined) board.scene = clone(scene);
      if (name !== undefined) board.name = name.trim();
      board.revision++;
      return board;
    });
  }
}
