import { join } from 'node:path';

const renderPolicy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self' data:; base-uri 'none'; form-action 'none'";

export async function renderInBrowser(origin, payload, { assetRoot } = {}) {
  const { chromium } = await import('playwright').catch(() => {
    throw new Error('画布渲染需要在运行 MCP 的机器上安装 Playwright 和 Chromium。');
  });
  const browser = await chromium.launch({
    ...(process.env.MCP_CHROME_CHANNEL ? { channel: process.env.MCP_CHROME_CHANNEL } : {}),
    timeout: 15_000,
  });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    if (assetRoot) await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const renderer = url.pathname === '/mcp-render.html';
      if (url.origin !== origin || (!renderer && !url.pathname.startsWith('/assets/'))) return route.abort();
      if (!assetRoot) return route.continue();
      // Remote rendering uses the built files directly and never contacts the whiteboard or an external origin.
      if (!renderer && !/^\/assets\/(?:[\w-]+\/)*[\w.-]+\.(?:js|css|woff2)$/.test(url.pathname)) {
        return route.abort();
      }
      try {
        await route.fulfill({
          path: join(assetRoot, url.pathname),
          ...(renderer && { headers: { 'Content-Security-Policy': renderPolicy } }),
        });
      } catch {
        await route.abort();
      }
    });
    await page.goto(origin + '/mcp-render.html', { timeout: 10_000 });
    await page.waitForFunction(() => typeof window.whiteboardRender === 'function', null, { timeout: 10_000 });
    let timer;
    try {
      return await Promise.race([
        page.evaluate(input => window.whiteboardRender(input), payload),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('画布渲染超时。')), 15_000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await browser.close();
  }
}
