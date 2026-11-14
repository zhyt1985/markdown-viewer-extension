import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeDialogs, exportFile, launchDesktop, openFile, openSettings } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop code buttons copy exact code, follow locale changes and stay out of exports', { timeout: 90000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-code-copy-'));
  const file = path.join(folder, 'code.md');
  const code = 'function demo() {\n\tconst message = "中文 <tag> & text";\n\n  return message;\n}\n';
  await fs.writeFile(file, ('# 示例\n\n```javascript\n' + code + '```\n\n    plain indented code\n').replaceAll('\n', '\r\n'));
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  let app;
  try {
    app = await launchDesktop({ executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    await app.evaluate(({ clipboard, dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      clipboard.writeText = text => { globalThis.__codeCopy = text; };
    }, file);
    await openFile(page);
    await page.waitForFunction(() => !window.desktopApp.state().busy && window.desktopApp.state().preview.current);
    const buttons = page.locator('#markdown-content .mv-code-copy-btn');
    assert.equal(await buttons.count(), 2);
    const first = buttons.first();
    assert.equal(await first.getAttribute('aria-label'), '复制代码');
    await first.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.mv-code-copy-btn')?.dataset.copyState === 'success');
    assert.equal(await app.evaluate(() => globalThis.__codeCopy), code);

    await openSettings(page);
    await page.selectOption('#locale', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await closeDialogs(page);
    await page.waitForFunction(() => document.querySelector('.mv-code-copy-btn')?.getAttribute('aria-label') === 'Copy code');
    await page.locator('#markdown-content pre').nth(1).hover();
    await buttons.nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('.mv-code-copy-btn')[1]?.dataset.copyState === 'success');
    assert.equal(await app.evaluate(() => globalThis.__codeCopy), 'plain indented code\n');

    const out = path.join(folder, 'code.html');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, out);
    await exportFile(page, 'html');
    await page.waitForFunction(() => window.desktopApp.state().task?.state === 'complete');
    const html = await fs.readFile(out, 'utf8');
    const printed = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { buttons: doc.querySelectorAll('.mv-code-copy-btn').length, code: doc.querySelector('pre code')?.textContent };
    }, html);
    assert.deepEqual(printed, { buttons: 0, code });
    assert.equal(await buttons.count(), 2);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
