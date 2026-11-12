import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomInt, randomUUID } from 'node:crypto';
import { renderInBrowser } from './mcp-render.js';
import diagramGuide from './upstream/design-guide.js';

export function createBoardMcp({ board, origin, render = payload => renderInBrowser(origin, payload), onTool }) {
  const server = new McpServer({ name: 'excalink', version: '0.1.0' });
  function registerTool(name, config, handler) {
    server.registerTool(name, config, async (...args) => {
      const start = performance.now();
      let ok = false;
      try {
        const response = await handler(...args);
        ok = !response.isError;
        return response;
      } finally {
        onTool?.(name, ok, Math.round(performance.now() - start));
      }
    });
  }
  const element = z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough();
  const shapeFields = {
    id: z.string().min(1).optional(),
    type: z.enum(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'freedraw', 'image', 'frame']),
    x: z.number(), y: z.number(), width: z.number().positive().optional(), height: z.number().positive().optional(),
    text: z.string().optional(), strokeColor: z.string().optional(), backgroundColor: z.string().optional(),
    strokeWidth: z.number().optional(), strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    roughness: z.number().optional(), opacity: z.number().min(0).max(100).optional(),
    fontSize: z.number().positive().optional(), fontFamily: z.union([z.string(), z.number()]).optional(),
    points: z.array(z.tuple([z.number(), z.number()])).max(10_000).optional(),
    groupIds: z.array(z.string()).optional(), locked: z.boolean().optional(), elbowed: z.boolean().optional(),
    fillStyle: z.string().optional(),
    roundness: z.strictObject({ type: z.number(), value: z.number().optional() }).nullable().optional(),
    fileId: z.string().optional(),
    startElementId: z.string().optional(), endElementId: z.string().optional(),
    startArrowhead: z.string().nullable().optional(), endArrowhead: z.string().nullable().optional(),
  };
  const shape = z.strictObject(shapeFields);
  const shapeInput = shape.partial().shape;
  const fonts = { virgil: 1, hand: 1, handwritten: 1, helvetica: 2, sans: 2, 'sans-serif': 2,
    cascadia: 3, mono: 3, monospace: 3, excalifont: 5, nunito: 6, lilita: 7, 'lilita one': 7, comic: 8, 'comic shanns': 8 };

  function makeElement(input) {
    const width = input.width ?? (input.type === 'text' ? Math.max(24, (input.text || '').length * 14) : 120);
    const height = input.height ?? (input.type === 'text' ? 25 : 72);
    const base = {
      id: randomUUID(), angle: 0, width, height, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
      fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
      groupIds: [], frameId: null, roundness: null, seed: randomInt(2 ** 31), version: 1,
      versionNonce: randomInt(2 ** 31), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
      ...input,
    };
    if (input.type === 'text') {
      const text = input.text || '';
      return { ...base, text, originalText: text, fontSize: input.fontSize || 20, fontFamily: typeof input.fontFamily === 'number' ? input.fontFamily : fonts[input.fontFamily?.toLowerCase()] || 5, textAlign: 'left',
        verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25 };
    }
    if (input.type === 'line' || input.type === 'arrow') {
      return { ...base, points: input.points || [[0, 0], [width, height]], lastCommittedPoint: null,
        startBinding: null, endBinding: null, startArrowhead: input.startArrowhead ?? null,
        endArrowhead: input.endArrowhead === undefined ? (input.type === 'arrow' ? 'arrow' : null) : input.endArrowhead };
    }
    if (input.type === 'freedraw') return { ...base, points: input.points || [[0, 0], [width, height]],
      pressures: [], simulatePressure: true, lastCommittedPoint: null };
    if (input.type === 'frame') return { ...base, name: input.text || null };
    if (input.type === 'image') return { ...base, fileId: input.fileId || null,
      status: input.fileId ? 'saved' : 'pending', scale: [1, 1], crop: null };
    return base;
  }
  function makeElements(inputs, existing) {
    const created = inputs.map(makeElement);
    const all = new Map([...existing, ...created].map(item => [item.id, item]));
    const labels = [];
    for (const [index, item] of created.entries()) {
      const input = inputs[index];
      if (item.type === 'arrow') {
        for (const [endpoint, id] of [['startBinding', input.startElementId], ['endBinding', input.endElementId]]) {
          if (!id) continue;
          const target = all.get(id);
          if (!target || target.isDeleted) throw new Error('箭头绑定的元素不存在。');
          item[endpoint] = { elementId: id, focus: 0, gap: 5 };
        }
        delete item.startElementId;
        delete item.endElementId;
      }
      if (item.type !== 'text' && input.text && ['rectangle', 'ellipse', 'diamond'].includes(item.type)) {
        const label = makeElement({ type: 'text', text: input.text, x: item.x + 8, y: item.y + 8,
          fontSize: input.fontSize, fontFamily: input.fontFamily });
        label.containerId = item.id;
        label.textAlign = 'center';
        label.verticalAlign = 'middle';
        item.boundElements = [{ type: 'text', id: label.id }];
        delete item.text;
        labels.push(label);
      }
    }
    return [...created, ...labels];
  }

  const version = { generation: z.string().uuid().optional(), revision: z.number().int().nonnegative().optional() };
  let observedGeneration;
  const checkpoints = new Map();

  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const failed = error => ({ ...result({ error: error.message }), isError: true });

  registerTool('query_elements', {
    description: 'Read the current board and its generation and revision. Elements use the Excalidraw scene format.',
    inputSchema: z.strictObject({
      type: z.string().optional(), ids: z.array(z.string()).optional(),
      filter: z.record(z.string(), z.unknown()).optional(),
      bbox: z.strictObject({ x_min: z.number().optional(), x_max: z.number().optional(), y_min: z.number().optional(), y_max: z.number().optional() }).optional(),
    }),
  }, async ({ type, ids, filter, bbox }) => {
    try {
      const snapshot = await board();
      observedGeneration = snapshot.generation;
      if (type || ids || filter || bbox) {
        const wanted = ids && new Set(ids);
        snapshot.scene.elements = snapshot.scene.elements.filter(item =>
          !item.isDeleted && (!type || item.type === type) && (!wanted || wanted.has(item.id)) &&
          (!filter || Object.entries(filter).every(([key, value]) => item[key] === value)) &&
          (!bbox || ((bbox.x_min ?? -Infinity) <= item.x && item.x <= (bbox.x_max ?? Infinity) &&
                     (bbox.y_min ?? -Infinity) <= item.y && item.y <= (bbox.y_max ?? Infinity))));
      }
      return result(snapshot);
    } catch (error) {
      return failed(error);
    }
  });

  function checkVersion(snapshot, input, expectedGeneration) {
    if ((expectedGeneration ?? snapshot.generation) !== snapshot.generation ||
        (input.revision ?? snapshot.revision) !== snapshot.revision) {
      throw new Error('当前白板已更新，请重新读取后再提交。');
    }
    observedGeneration ??= snapshot.generation;
  }

  async function commit(snapshot, scene) {
    const { generation, revision } = snapshot;
    return board('PUT', { generation, revision, scene });
  }

  function mutate(name, description, shape, change, describe = () => ({})) {
    registerTool(name, {
      description: description + ' Optionally supply generation and revision for an explicit precondition.',
      inputSchema: z.strictObject({ ...version, ...shape }),
    }, async input => {
      try {
        const expectedGeneration = input.generation ?? observedGeneration;
        const snapshot = await board();
        checkVersion(snapshot, input, expectedGeneration);
        const elements = change(snapshot.scene.elements, input);
        const saved = await commit(snapshot, { ...snapshot.scene, elements });
        return result({ generation: saved.generation, revision: saved.revision,
          elementIds: saved.scene.elements.filter(item => !item.isDeleted).map(item => item.id),
          ...describe(saved.scene.elements, input) });
      } catch (error) {
        return failed(error);
      }
    });
  }

  function appendElements(elements, additions) {
    const used = new Set(elements.map(item => item.id));
    for (const item of additions) {
      if (used.has(item.id)) throw new Error('元素 ID 已存在。');
      used.add(item.id);
    }
    return [...elements, ...additions];
  }
  mutate('create_element', 'Append a shape or a complete Excalidraw element to the current board.', {
    ...shapeInput, element: element.optional(), shape: shape.optional(),
  }, (elements, input) => {
    const { element: raw, shape: nested, revision, generation, ...flat } = input;
    if ([raw, nested, flat.type].filter(Boolean).length !== 1) throw new Error('请提供一种元素表示。');
    return appendElements(elements, raw ? [raw] : makeElements([shape.parse(nested || flat)], elements));
  });
  mutate('batch_create_elements', 'Append up to 100 shapes in a single transaction.', {
    shapes: z.array(shape).min(1).max(100).optional(), elements: z.array(shape).min(1).max(100).optional(),
  }, (elements, input) => {
    if (Boolean(input.shapes) === Boolean(input.elements)) throw new Error('请提供 elements 或 shapes 之一。');
    return appendElements(elements, makeElements(input.elements || input.shapes, elements));
  });
  registerTool('get_element', {
    description: 'Read one element from the current board.',
    inputSchema: z.strictObject({ id: z.string() }),
  }, async ({ id }) => {
    try {
      const { generation, revision, scene } = await board();
      observedGeneration = generation;
      const item = scene.elements.find(item => item.id === id && !item.isDeleted);
      if (!item) throw new Error('找不到该元素。');
      return result({ generation, revision, element: item });
    } catch (error) {
      return failed(error);
    }
  });
  mutate('update_element', 'Update a current board element without changing its ID or type.', {
    ...shapeInput, id: z.string(), changes: z.record(z.string(), z.unknown()).optional(),
  }, (elements, { id, changes, generation, revision, ...flat }) => {
    const target = elements.find(item => item.id === id && !item.isDeleted);
    if (!target) throw new Error('找不到该元素。');
    const patch = { ...flat, ...changes };
    if (patch.type !== undefined && patch.type !== target.type) throw new Error('不能改变现有元素类型。');
    if (typeof patch.fontFamily === 'string') patch.fontFamily = fonts[patch.fontFamily.toLowerCase()] || 5;
    if (target.type === 'text' && typeof patch.text === 'string') patch.originalText = patch.text;
    const label = target.type !== 'text' && typeof patch.text === 'string' && ['rectangle', 'ellipse', 'diamond'].includes(target.type)
      ? elements.find(item => item.containerId === id && !item.isDeleted) : null;
    let addedLabel;
    if (target.type !== 'text' && typeof patch.text === 'string' && ['rectangle', 'ellipse', 'diamond'].includes(target.type)) {
      if (!label && patch.text) {
        addedLabel = makeElement({ type: 'text', text: patch.text, x: (patch.x ?? target.x) + 8, y: (patch.y ?? target.y) + 8,
          fontSize: patch.fontSize, fontFamily: patch.fontFamily });
        Object.assign(addedLabel, { containerId: id, textAlign: 'center', verticalAlign: 'middle' });
        patch.boundElements = [...(target.boundElements || []), { id: addedLabel.id, type: 'text' }];
      }
      if (!label) delete patch.text;
    }
    const next = elements.map(item => {
      const updates = item.id === id ? { ...patch, id, type: item.type } : item === label ?
        { text: patch.text, originalText: patch.text, ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
          ...(patch.fontFamily ? { fontFamily: patch.fontFamily } : {}) } : null;
      return updates ? { ...item, ...updates, version: (item.version || 0) + 1,
        versionNonce: randomInt(2 ** 31), updated: Date.now() } : item;
    });
    return addedLabel ? [...next, addedLabel] : next;
  });
  mutate('delete_element', 'Remove an element from the current board.', { id: z.string() }, (elements, { id }) => {
    if (!elements.some(item => item.id === id && !item.isDeleted)) throw new Error('找不到该元素。');
    return elements.map(item => item.id === id ? { ...item, isDeleted: true, version: (item.version || 0) + 1 } : item);
  });

  const idList = z.array(z.string()).min(1).max(500);
  const selection = { ids: idList.optional(), elementIds: idList.optional() };
  function selectedIds({ elementIds, ids }) {
    if (Boolean(elementIds) === Boolean(ids)) throw new Error('请提供 elementIds 或 ids 之一。');
    return elementIds || ids;
  }
  function changeSelected(elements, ids, change) {
    const wanted = new Set(ids);
    const selected = elements.filter(item => !item.isDeleted && wanted.has(item.id));
    if (selected.length !== wanted.size) throw new Error('有元素已不存在。');
    const patches = change(selected);
    return elements.map(item => {
      const patch = patches.get(item.id);
      return patch ? { ...item, ...patch, version: (item.version || 0) + 1,
        versionNonce: randomInt(2 ** 31), updated: Date.now() } : item;
    });
  }
  for (const [name, locked] of [['lock_elements', true], ['unlock_elements', false]]) {
    mutate(name, 'Change the editing lock on selected current-board elements.', selection,
      (elements, input) => changeSelected(elements, selectedIds(input), selected => new Map(selected.map(item => [item.id, { locked }]))));
  }
  mutate('group_elements', 'Group selected elements on the current board.', selection, (elements, input) => {
    const ids = selectedIds(input);
    const group = randomUUID();
    return changeSelected(elements, ids, selected => new Map(selected.map(item => [item.id, {
      groupIds: [...(item.groupIds || []), group],
    }])));
  }, (elements, input) => {
    const elementIds = selectedIds(input);
    return { elementIds, groupId: elements.find(item => item.id === elementIds[0]).groupIds.at(-1), successCount: new Set(elementIds).size };
  });
  mutate('ungroup_elements', 'Remove the outermost group from selected elements.', { ...selection, groupId: z.string().optional() }, (elements, input) => {
    const ids = input.groupId ? elements.filter(item => !item.isDeleted && item.groupIds?.includes(input.groupId)).map(item => item.id) : selectedIds(input);
    return changeSelected(elements, ids, selected => new Map(selected.map(item => [item.id, {
      groupIds: input.groupId ? item.groupIds.filter(id => id !== input.groupId) : (item.groupIds || []).slice(0, -1),
    }])));
  });
  mutate('clear_canvas', 'Clear all elements on the current board.', { confirm: z.literal(true) }, elements => {
    const ids = elements.filter(item => !item.isDeleted).map(item => item.id);
    return changeSelected(elements, ids, selected => new Map(selected.map(item => [item.id, { isDeleted: true }])));
  });
  registerTool('export_scene', {
    description: 'Return the current board as inline Excalidraw JSON, including its image data.',
    inputSchema: z.strictObject({ filePath: z.string().optional() }),
  }, async ({ filePath }) => {
    try {
      if (filePath !== undefined) throw new Error('仅支持返回当前白板 JSON，不能访问本机文件。');
      const { scene } = await board();
      return result({ type: 'excalidraw', version: 2, source: 'personal-whiteboard', ...scene });
    } catch (error) {
      return failed(error);
    }
  });

  function readTool(name, description, schema, read) {
    registerTool(name, { description, inputSchema: z.strictObject(schema) }, async input => {
      try {
        const snapshot = await board();
        observedGeneration = snapshot.generation;
        return result(await read(snapshot, input));
      } catch (error) {
        return failed(error);
      }
    });
  }

  mutate('align_elements', 'Align current-board elements against a common edge or center.', {
    ...selection, alignment: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']),
  }, (elements, input) => changeSelected(elements, selectedIds(input), items => {
    const horizontal = ['left', 'center', 'right'].includes(input.alignment);
    const [axis, size] = horizontal ? ['x', 'width'] : ['y', 'height'];
    const start = Math.min(...items.map(item => item[axis]));
    const end = Math.max(...items.map(item => item[axis] + item[size]));
    const center = ['center', 'middle'].includes(input.alignment);
    const leading = ['left', 'top'].includes(input.alignment);
    return new Map(items.map(item => [item.id, { [axis]: center ? (start + end - item[size]) / 2 : leading ? start : end - item[size] }]));
  }));

  mutate('distribute_elements', 'Distribute current-board elements with equal gaps.', {
    ...selection, direction: z.enum(['horizontal', 'vertical']),
  }, (elements, input) => changeSelected(elements, selectedIds(input), items => {
    if (items.length < 3) throw new Error('等距分布至少需要三个元素。');
    const [axis, size] = input.direction === 'horizontal' ? ['x', 'width'] : ['y', 'height'];
    items.sort((a, b) => a[axis] - b[axis]);
    let offset = items[0][axis];
    const end = items.at(-1)[axis] + items.at(-1)[size];
    const gap = (end - offset - items.reduce((sum, item) => sum + item[size], 0)) / (items.length - 1);
    return new Map(items.map(item => {
      const patch = { [axis]: offset };
      offset += item[size] + gap;
      return [item.id, patch];
    }));
  }));

  mutate('duplicate_elements', 'Duplicate elements in the current board.', {
    ...selection, offsetX: z.number().optional(), offsetY: z.number().optional(),
  }, (elements, input) => {
    const ids = new Set(selectedIds(input));
    const items = elements.filter(item => !item.isDeleted && (ids.has(item.id) || ids.has(item.containerId)));
    if ([...ids].some(id => !items.some(item => item.id === id))) throw new Error('有元素已不存在。');
    const remap = new Map(items.map(item => [item.id, randomUUID()]));
    const groups = new Map();
    return appendElements(elements, items.map(item => {
      const { index, ...copy } = item;
      return {
        ...copy, id: remap.get(item.id), x: item.x + (input.offsetX ?? 20), y: item.y + (input.offsetY ?? 20),
        version: 1, versionNonce: randomInt(2 ** 31), updated: Date.now(),
        groupIds: (item.groupIds || []).map(group => {
          if (!groups.has(group)) groups.set(group, randomUUID());
          return groups.get(group);
        }),
        containerId: remap.get(item.containerId) || null, frameId: remap.get(item.frameId) || null,
        boundElements: (item.boundElements || []).filter(binding => remap.has(binding.id))
          .map(binding => ({ ...binding, id: remap.get(binding.id) })),
        ...(item.type === 'arrow' ? Object.fromEntries(['startBinding', 'endBinding'].map(key => [key,
          remap.has(item[key]?.elementId) ? { ...item[key], elementId: remap.get(item[key].elementId) } : null])) : {}),
      };
    }));
  });

  readTool('describe_scene', 'Summarize the current board and its visible elements.', {}, ({ scene }) => {
    const elements = scene.elements.filter(item => !item.isDeleted);
    return { count: elements.length, elements: elements.map(({ id, type, x, y, width, height, text, locked }) =>
      ({ id, type, x, y, width, height, text, locked })) };
  });
  readTool('get_resource', 'Read a resource belonging to the current board.', {
    resource: z.enum(['scene', 'library', 'elements', 'theme']),
  }, async ({ scene }, { resource }) => {
    const theme = scene.appState.theme || 'light';
    if (resource === 'scene') {
      const { selectedElementIds } = await board('GET', undefined, '/selection');
      return { ...scene, theme, selectedElements: selectedElementIds };
    }
    if (resource === 'theme') return { theme };
    return { elements: scene.elements.filter(item => !item.isDeleted) };
  });
  readTool('snapshot_scene', 'Keep a temporary checkpoint for this MCP session and current board generation.', {
    name: z.string().min(1).max(100),
  }, ({ generation, scene }, { name }) => {
    if (checkpoints.size >= 4 && !checkpoints.has(name)) throw new Error('此连接最多保留四个临时检查点。');
    checkpoints.set(name, { generation, scene });
    return { name, elementCount: scene.elements.length };
  });

  function writeSceneTool(name, description, schema, transform) {
    registerTool(name, { description, inputSchema: z.strictObject({ ...version, ...schema }) }, async input => {
      try {
        const expectedGeneration = input.generation ?? observedGeneration;
        const snapshot = await board();
        checkVersion(snapshot, input, expectedGeneration);
        const scene = await transform(snapshot, input);
        const saved = await commit(snapshot, scene);
        return result({ generation: saved.generation, revision: saved.revision, count: saved.scene.elements.length });
      } catch (error) {
        return failed(error);
      }
    });
  }
  writeSceneTool('restore_snapshot', 'Restore a checkpoint within its original board generation.', {
    name: z.string().min(1).max(100),
  }, ({ generation }, { name }) => {
    const checkpoint = checkpoints.get(name);
    if (!checkpoint || checkpoint.generation !== generation) throw new Error('当前画布没有这个临时检查点。');
    return checkpoint.scene;
  });
  writeSceneTool('import_scene', 'Import inline Excalidraw data into the current board.', {
    data: z.string().max(20 * 1024 * 1024).optional(), filePath: z.string().optional(), mode: z.enum(['replace', 'merge']),
  }, ({ scene }, input) => {
    if (input.filePath !== undefined) throw new Error('请提供内联 data，不能访问本机文件。');
    const imported = JSON.parse(input.data || 'null');
    if (!Array.isArray(imported?.elements)) throw new Error('缺少 Excalidraw elements。');
    if (input.mode === 'replace') return { elements: imported.elements, appState: imported.appState || {}, files: imported.files || {} };
    const files = { ...scene.files };
    for (const [id, file] of Object.entries(imported.files || {})) {
      if (Object.hasOwn(files, id) && JSON.stringify(files[id]) !== JSON.stringify(file)) throw new Error('图片 ID 冲突。');
      Object.defineProperty(files, id, { value: file, enumerable: true, configurable: true, writable: true });
    }
    return { ...scene, elements: appendElements(scene.elements, imported.elements), files };
  });
  registerTool('read_diagram_guide', { description: 'Read the upstream Excalidraw diagram design guide.', inputSchema: z.strictObject({}) },
    async () => ({ content: [{ type: 'text', text: diagramGuide }] }));

  const renderFields = {
    background: z.boolean().optional(), renderer: z.enum(['auto', 'node', 'browser']).optional(),
    dark: z.boolean().optional(), scale: z.number().min(1).max(4).optional(),
    padding: z.number().min(0).max(100).optional(), elementIds: idList.optional(),
    frameId: z.string().optional(), embedScene: z.boolean().optional(),
  };
  async function renderOutput(format, options) {
    if (options.filePath !== undefined) throw new Error('仅支持内联输出，不能写入本机文件。');
    if (options.renderer === 'node') throw new Error('此部署支持 browser 或 auto 渲染。');
    const snapshot = await board();
    observedGeneration = snapshot.generation;
    const image = await render({ operation: 'image', scene: snapshot.scene, format, options });
    return image.png ? { content: [{ type: 'image', mimeType: 'image/png', data: image.png }] } :
      { content: [{ type: 'text', text: image.svg }] };
  }
  for (const name of ['export_to_image', 'get_canvas_screenshot']) {
    const screenshot = name === 'get_canvas_screenshot';
    const schema = screenshot ? renderFields : { ...renderFields,
      format: z.enum(['png', 'svg']), filePath: z.string().optional() };
    registerTool(name, { description: 'Render the current board using a local browser.', inputSchema: z.strictObject(schema) },
      async input => {
        try { return await renderOutput(screenshot ? 'png' : input.format, input); }
        catch (error) { return failed(error); }
      });
  }
  writeSceneTool('create_from_mermaid', 'Convert Mermaid into editable current-board elements locally.', {
    mermaidDiagram: z.string().min(1).max(20_000),
    config: z.strictObject({ startOnLoad: z.boolean().optional(),
      flowchart: z.strictObject({ curve: z.enum(['linear', 'basis']).optional() }).optional(),
      themeVariables: z.strictObject({ fontSize: z.string().optional() }).optional(),
      maxEdges: z.number().int().positive().max(500).optional(),
      maxTextSize: z.number().int().positive().max(20_000).optional(),
    }).optional(),
  }, async ({ scene }, { mermaidDiagram, config }) => {
    const converted = await render({
      operation: 'mermaid', diagram: mermaidDiagram, options: config,
    });
    for (const id of Object.keys(converted.files)) if (Object.hasOwn(scene.files, id)) throw new Error('图片 ID 冲突。');
    return { ...scene, elements: appendElements(scene.elements, converted.elements), files: { ...scene.files, ...converted.files } };
  });
  registerTool('export_to_excalidraw_url', {
    description: 'External upload is unavailable in the self-hosted whiteboard. Use export_scene for inline JSON.',
    inputSchema: z.strictObject({}),
  }, async () => failed(new Error('此部署不上传到 excalidraw.com。可使用 export_scene 导出当前白板。')));

  readTool('get_selection', 'Read the last active current-board browser selection.', {}, () => board('GET', undefined, '/selection'));
  registerTool('set_viewport', {
    description: 'Set the viewport of connected current-board browsers.',
    inputSchema: z.strictObject({
      ...version,
      scrollToContent: z.boolean().optional(), scrollToElementIds: idList.optional(),
      viewportZoomFactor: z.number().positive().max(1).optional(), scrollToElementId: z.string().optional(),
      zoom: z.number().min(0.1).max(10).optional(), offsetX: z.number().optional(), offsetY: z.number().optional(),
    }),
  }, async input => {
    try {
      const { generation, revision, ...viewport } = input;
      const fit = viewport.scrollToContent === true;
      const subset = Boolean(viewport.scrollToElementIds);
      const single = Boolean(viewport.scrollToElementId);
      const manual = ['zoom', 'offsetX', 'offsetY'].some(key => viewport[key] !== undefined);
      if ([fit, subset, single, manual].filter(Boolean).length !== 1 ||
          (viewport.viewportZoomFactor !== undefined && !fit && !subset)) throw new Error('请选择一种视口模式。');
      const expectedGeneration = generation ?? observedGeneration;
      const snapshot = await board();
      checkVersion(snapshot, input, expectedGeneration);
      return result(await board('POST', { generation: snapshot.generation, revision: snapshot.revision, viewport }, '/viewport'));
    } catch (error) {
      return failed(error);
    }
  });

  return server;
}
