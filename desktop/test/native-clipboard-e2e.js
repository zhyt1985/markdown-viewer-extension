import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchDesktop } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

// Run explicitly with node --test desktop/test/native-clipboard-e2e.js on an idle desktop.
// This test uses the system clipboard and is excluded from the default test glob.
test('desktop table, image and HTML draft use the system clipboard', { timeout: 120000 }, async () => {
  const artifacts = path.join(root, 'test-results/desktop/native-clipboard');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const source = path.join(folder, 'Clipboard.md');
  await Promise.all([
    fs.writeFile(source, '# Clipboard\n\n| Case | Value |\n| --- | --- |\n| Text | 007 |\n\n![Clipboard image](icon.png)\n'),
    fs.copyFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'), path.join(folder, 'icon.png')),
  ]);
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const app = await launchDesktop({
    executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')]), source],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    page.setDefaultTimeout(15000);
    const status = text => page.waitForFunction(text => document.getElementById('status').textContent.includes(text), text);
    await page.waitForFunction(() => window.desktopApp?.state().preview.current);

    await app.evaluate(({ clipboard }) => clipboard.writeText('Clipboard test control'));
    await page.locator('#markdown-content th').first().click({ button: 'right' });
    await page.locator('[data-table-action="copy"]').click();
    await status('已将表格复制到剪贴板');
    const table = await app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('text/html'));
      return { text: await clipboard.readText(), html: item && await (await item.getType('text/html')).text() };
    });
    assert.deepEqual(table.text.trim().split(/\r?\n/), ['Case\tValue', 'Text\t007']);
    assert.match(table.html, />007<\/td>/i);

    const image = page.locator('#markdown-content img[alt="Clipboard image"]');
    await image.evaluate(node => node.decode());
    await image.click({ button: 'right' });
    await page.locator('[data-image-action="copy"]').click();
    await status('已将图片复制到剪贴板');
    const png = await app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
      const bytes = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
      return { signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    });
    assert.deepEqual(png, { signature: '89504e470d0a1a0a', width: 48, height: 48 });

    const paragraph = 'This paragraph was imported from the system HTML clipboard. '.repeat(8).trim();
    await app.evaluate(({ clipboard, ClipboardItem }, paragraph) => clipboard.write([new ClipboardItem({
      'text/html': `<title>Clipboard draft</title><article><p>${paragraph}</p></article>`,
      'text/plain': 'The plain text fallback should not be imported.',
    })]), paragraph);
    await page.locator('[data-shell-action="file-menu"]').click();
    await page.locator('#paste-html').click();
    await page.waitForFunction(() => {
      const state = window.desktopApp?.state();
      return state?.document?.untitled && state.preview.current;
    });
    const draft = await page.evaluate(() => window.desktopCodeEditor.getText());
    assert.ok(draft.includes(paragraph));
    assert.doesNotMatch(draft, /fallback should not be imported/);
  } finally {
    await app.close();
  }
});
