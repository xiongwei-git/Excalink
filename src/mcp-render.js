export async function renderInBrowser(origin, payload) {
  const { chromium } = await import('playwright').catch(() => {
    throw new Error('本机渲染需要安装 Playwright 和 Chromium，见 README。');
  });
  const browser = await chromium.launch({
    ...(process.env.MCP_CHROME_CHANNEL ? { channel: process.env.MCP_CHROME_CHANNEL } : {}),
    timeout: 15_000,
  });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && (url.pathname === '/mcp-render.html' || url.pathname.startsWith('/assets/'))) {
        return route.continue();
      }
      return route.abort();
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
