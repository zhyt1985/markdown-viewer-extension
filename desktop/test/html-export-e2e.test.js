import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '../node_modules/@napi-rs/canvas/index.js';
import { closeDialogs, documentMenu, exportFile, launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop writes a static HTML file that reopens independently offline', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'html-export');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const docs = path.join(folder, '文档');
  const assets = path.join(folder, '额外图片');
  const portable = path.join(folder, '可移交');
  await Promise.all([docs, assets, portable].map(directory => fs.mkdir(directory)));
  const input = path.join(docs, '原稿 #%.md');
  const other = path.join(docs, '其他.md');
  const jpeg = path.join(assets, '照片 #.jpg');
  const source = `# 离线导出 & 样式

Math: $x^2 + y^2$.

![本机图](./图标.png)

![授权图](../额外图片/照片%20%23.jpg)

| Column A | Column B |
| --- | --- |
| Value A | Value B |

\`\`\`mermaid
flowchart LR
  A[Local] --> B[Portable]
\`\`\`

\`\`\`js
const x = 42;
\`\`\`

A footnote.[^one]

[^one]: Footnote text.

<script>window.exportedScriptRan = true;</script>
`;
  const png = path.join(root, 'test/fixtures/layout/assets/icon48.png');
  const raster = createCanvas(48, 48);
  raster.getContext('2d').drawImage(await loadImage(png), 0, 0);
  await Promise.all([
    fs.writeFile(input, source), fs.writeFile(other, '# Second document'),
    fs.copyFile(png, path.join(docs, '图标.png')), fs.writeFile(jpeg, raster.toBuffer('image/jpeg')),
  ]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const ready = (name = null) => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null || state.document?.filename === name);
    }, name);
    const status = () => page.locator('#status').innerText();
    const openPicker = file => app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    const savePicker = filePath => app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: !filePath, filePath });
    }, filePath);
    const settled = () => page.waitForFunction(() => !window.desktopApp.state().exporting, null, { timeout: 45000 });
    async function pick(file) { await openPicker(file); await openFile(page); await ready(path.basename(file)); }
    async function activate(file) { await page.locator('.tab-open', { hasText: path.basename(file) }).click(); await ready(path.basename(file)); }
    await ready();
    await pick(input);
    assert.equal(await page.locator('#export-open').isDisabled(), true, 'missing image prevents export before it is authorized');
    await openPicker(assets);
    await documentMenu(page, '#resource-folders-open');
    await page.click('#resource-folder-add');
    await ready(); await closeDialogs(page);
    assert.equal(await page.locator('#export-open').isEnabled(), true, await status());

    await t.test('export preserves fonts, image types, diagrams and document structure in a moved offline file', async () => {
      const output = path.join(folder, '导出.html');
      const relocated = path.join(portable, '只带这一个文件.html');
      await page.evaluate(() => globalThis.platform.settings.set('imageLayout', 'left'));
      const preview = await page.locator('#markdown-content').innerHTML();
      await savePicker(output);
      await page.click('#export-open');
      await page.click('[data-export-format="html"]');
      assert.match(await page.locator('#export-html-note').innerText(), /数学字体将嵌入 HTML/);
      await page.click('#export-start'); await settled();
      assert.match(await status(), /已保存/);
      assert.equal(await page.locator('#markdown-content').innerHTML(), preview, 'export must leave the foreground document intact');
      await fs.rename(output, relocated);
      assert.deepEqual(await fs.readdir(portable), [path.basename(relocated)]);
      const text = await fs.readFile(relocated, 'utf8');
      assert.match(text, /<title>离线导出 &amp; 样式<\/title>/);
      assert.doesNotMatch(text, /cdn\.jsdelivr|documd:\/\/|<script\b|<link\b|id="(?:desktop-toolbar|editor-pane|mv-source-view)"/);
      const render = await app.evaluate(async ({ BrowserWindow, session }, file) => {
        const partition = session.fromPartition('verify-offline-html');
        const denied = [];
        partition.webRequest.onBeforeRequest((details, respond) => {
          const allowed = details.url === file || details.url.startsWith('data:');
          if (!allowed) denied.push(details.url);
          respond({ cancel: !allowed });
        });
        const browser = new BrowserWindow({ show: false, webPreferences: { session: partition, nodeIntegration: false, sandbox: true } });
        try {
          await browser.loadURL(file);
          const result = await browser.webContents.executeJavaScript(`(async () => {
            await document.fonts.ready;
            const images = await Promise.all([...document.images].map(async img => {
              await img.decode();
              return { alt: img.alt, type: img.getAttribute('src').split(';')[0], width: img.naturalWidth };
            }));
            return {
              title: document.title, text: document.querySelector('#markdown-content h1').textContent,
              math: Boolean(document.querySelector('.katex')),
              mathFont: [...document.fonts].some(font => font.family === 'KaTeX_Math' && font.status === 'loaded'),
              tables: document.querySelectorAll('#markdown-content table').length,
              diagram: Boolean(document.querySelector('.diagram-block[data-plugin-type="mermaid"] img')),
              footnote: (() => {
                const ref = document.querySelector('.footnote-ref a');
                const href = ref?.getAttribute('href');
                ref?.click();
                return Boolean(href && location.hash === href && document.getElementById(href.slice(1))?.textContent.includes('Footnote text.'));
              })(),
              code: document.querySelector('pre code').textContent.trim(),
              layout: document.getElementById('markdown-content').classList.contains('image-layout-left'),
              background: getComputedStyle(document.getElementById('markdown-page')).backgroundColor,
              script: typeof window.exportedScriptRan, images,
            };
          })()`);
          return { ...result, denied };
        } finally { browser.destroy(); }
      }, pathToFileURL(relocated).href);
      assert.equal(render.title, '离线导出 & 样式');
      assert.equal(render.text, render.title);
      assert.ok(render.math && render.mathFont && render.diagram && render.footnote && render.layout, JSON.stringify(render));
      assert.equal(render.tables, 1);
      assert.match(render.code, /const x = 42/);
      assert.notEqual(render.background, 'rgba(0, 0, 0, 0)');
      assert.equal(render.script, 'undefined');
      assert.deepEqual(render.images.filter(image => image.alt === '本机图' || image.alt === '授权图'), [
        { alt: '本机图', type: 'data:image/png', width: 48 }, { alt: '授权图', type: 'data:image/jpeg', width: 48 },
      ]);
      assert.ok(render.images.every(image => image.type.startsWith('data:image/') && image.width > 0));
      assert.deepEqual(render.denied, []);
    });

    await t.test('export keeps the original document snapshot after switching tabs', async () => {
      const output = path.join(folder, 'snapshot.html');
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = () => new Promise(resolve => { globalThis.completeHtmlExport = resolve; }); });
      await exportFile(page, 'html');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await pick(other);
      await app.evaluate((_electron, filePath) => globalThis.completeHtmlExport({ canceled: false, filePath }), output);
      await settled();
      assert.match(await status(), /已保存/);
      const bytes = await fs.readFile(output, 'utf8');
      assert.match(bytes, /离线导出 &amp; 样式/);
      assert.doesNotMatch(bytes, /Second document/);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Second document');
    });

    await t.test('canceled or incomplete exports leave no HTML file behind', async () => {
      await activate(input);
      await savePicker(null);
      await exportFile(page, 'html'); await settled();
      assert.match(await status(), /已取消导出/);
      const output = path.join(folder, 'incomplete.html');
      await fs.rename(jpeg, `${jpeg}.moved`);
      await savePicker(output);
      await exportFile(page, 'html'); await settled();
      assert.match(await status(), /操作失败.*授权图/);
      await assert.rejects(fs.access(output), { code: 'ENOENT' });
      assert.equal(await fs.readFile(input, 'utf8'), source);
    });
  } finally { await app.close(); }
});
