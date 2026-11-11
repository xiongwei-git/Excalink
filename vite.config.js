import { cp } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  build: { rolldownOptions: { input: ['index.html', 'mcp-render.html'] } },
  plugins: [{
    name: 'local-excalidraw-assets',
    async closeBundle() {
      await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/assets/fonts', { recursive: true });
      await cp('notices', 'dist/notices', { recursive: true });
    },
  }],
});
