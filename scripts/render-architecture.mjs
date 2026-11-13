import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const executablePath =
  process.env.HUB_BROWSER_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : '/usr/bin/google-chrome');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 3,
  });
  await page.goto(
    'data:image/svg+xml;base64,' +
      Buffer.from(readFileSync('docs/architecture.svg')).toString('base64'),
  );
  await page.screenshot({ path: 'docs/architecture.png' });
} finally {
  await browser.close();
}
