import { convertToExcalidrawElements, exportToBlob, exportToSvg, restore } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';

window.EXCALIDRAW_ASSET_PATH = '/assets/';

window.whiteboardRender = async ({ operation, scene, format, options, diagram }) => {
  if (operation === 'mermaid') {
    const { elements, files } = await parseMermaidToExcalidraw(diagram, options);
    return { elements: convertToExcalidrawElements(elements), files: files || {} };
  }
  const restored = restore(scene, null, null);
  const selected = options.elementIds && new Set(options.elementIds);
  const elements = restored.elements.filter(element => !element.isDeleted &&
    (!selected || selected.has(element.id) || selected.has(element.containerId)) &&
    (!options.frameId || element.frameId === options.frameId || element.id === options.frameId));
  if (!elements.length) throw new Error('没有可导出的元素。');
  const scale = options.scale ?? 1;
  const minX = Math.min(...elements.map(element => element.x - Math.abs(element.width)));
  const maxX = Math.max(...elements.map(element => element.x + Math.abs(element.width)));
  const minY = Math.min(...elements.map(element => element.y - Math.abs(element.height)));
  const maxY = Math.max(...elements.map(element => element.y + Math.abs(element.height)));
  const width = (maxX - minX + 64) * scale;
  const height = (maxY - minY + 64) * scale;
  if (!Number.isFinite(width * height) || width > 8192 || height > 8192 || width * height > 20_000_000) {
    throw new Error('导出尺寸过大，请缩小范围或比例。');
  }
  const config = {
    elements, files: restored.files,
    appState: { ...restored.appState, exportBackground: options.background ?? true,
      exportWithDarkMode: options.dark ?? false, exportScale: scale, exportEmbedScene: options.embedScene ?? false },
    exportPadding: options.padding ?? 10,
  };
  if (format === 'svg') {
    const svg = await exportToSvg(config);
    return { svg: new XMLSerializer().serializeToString(svg) };
  }
  const blob = await exportToBlob({ ...config, mimeType: 'image/png' });
  return { png: await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }) };
};
