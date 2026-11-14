import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { launchDesktop, openFile, exportFile } from './ui-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));

test('reading layout, content zoom and native fullscreen preserve document state and export pagination', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'reading-layout');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const first = path.join(folder, '阅读布局甲.md');
  const second = path.join(folder, '阅读布局乙.md');
  const paragraph = '这段正文会随阅读宽度重新换行，用于检查段落定位。'.repeat(6);
  const wideTable = '| 甲 | 乙 | 丙 | 丁 | 戊 |\n|---|---|---|---|---|\n'
    + `| \`${'wide_table_cell_'.repeat(16)}\` | 较长文字 | 较长文字 | 较长文字 | 较长文字 |\n`;
  const long = '# 阅读布局甲\n\n' + Array.from({ length: 30 }, (_, i) => `## 章节 ${i + 1}\n\n${paragraph}\n\n`).join('') + wideTable;
  await Promise.all([fs.writeFile(first, long), fs.writeFile(second, '# 阅读布局乙\n\n短段落。\n')]);
  let app, page;
  const errors = [];
  const ready = () => page.waitForFunction(() => window.desktopApp?.state().preview.current && !window.desktopApp.state().busy);
  const launch = async () => {
    const executable = process.env.MV_DESKTOP_EXECUTABLE;
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.desktopShell) && !document.getElementById('open').disabled);
  };
  const chooseOpen = async selected => app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, selected);
  const layout = async name => {
    await page.click('#reading-open');
    await page.click(`[data-reading-layout="${name}"]`);
  };
  const mode = name => page.click(`[data-shell-mode="${name}"]`);
  const zoom = percent => page.waitForFunction(percent => document.getElementById('reading-open').textContent === `${percent}%`, percent);
  const top = () => page.locator('#reader').evaluate(node => node.scrollTop);
  const width = () => page.locator('#markdown-page').evaluate(node => node.getBoundingClientRect().width);
  const sourceLine = () => page.evaluate(() => window.desktopViewer.sourceLine());
  const activeTab = name => page.locator('.tab-open', { hasText: name });
  const pdfSnapshot = async destination => {
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, destination);
    await exportFile(page, 'pdf');
    await page.waitForFunction(() => window.desktopApp.state().task?.state === 'complete');
    const loading = getDocument({ data: new Uint8Array(await fs.readFile(destination)), useSystemFonts: true,
      standardFontDataUrl: `${path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/` });
    const pdf = await loading.promise;
    try {
      const first = await pdf.getPage(1);
      const content = (await first.getTextContent()).items.map(item => ({ str: item.str, transform: item.transform }));
      assert.match(content.map(item => item.str).join(''), /阅读布局甲/);
      return { numPages: pdf.numPages, view: first.view, content };
    } finally { await loading.destroy(); }
  };

  try {
    await launch();
    await chooseOpen(first);
    await openFile(page);
    await ready();

    await t.test('three width presets and zoom affect only the reading surface and keep the current paragraph', async () => {
      await page.locator('#desktop-toolbar [data-shell-action="focus"]').click();
      const standard = await width();
      await layout('fullscreen');
      const wide = await width();
      assert.ok(wide > standard, `expected ${wide} to exceed ${standard}`);
      await layout('narrow');
      assert.ok(await width() < standard);
      await page.locator('#reader').evaluate(node => { node.scrollTop = 1250; });
      const line = await sourceLine();
      const shellHeight = await page.locator('#app-header').evaluate(node => node.getBoundingClientRect().height);
      const titleHeight = await page.locator('#markdown-content h1').evaluate(node => node.getBoundingClientRect().height);
      await page.click('#reading-open');
      await page.click('#reading-zoom-in');
      await zoom(110);
      assert.ok(Math.abs(await sourceLine() - line) < 1);
      assert.equal(await page.locator('#app-header').evaluate(node => node.getBoundingClientRect().height), shellHeight);
      assert.ok(await page.locator('#markdown-content h1').evaluate(node => node.getBoundingClientRect().height) > titleHeight);
      assert.equal(await page.locator('#reading-open').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('ControlOrMeta+0');
      await zoom(100);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#desktop-app').evaluate(node => node.classList.contains('focus-mode')), false);
    });

    await t.test('reading state survives source mode, a tab switch, and a full restart', async () => {
      await page.keyboard.press('ControlOrMeta+=');
      await page.keyboard.press('ControlOrMeta+=');
      await zoom(125);
      await page.locator('#reader').evaluate(node => { node.scrollTop = 1520; });
      const position = await top();
      await mode('source');
      assert.equal(await page.locator('#reading-open').isDisabled(), true);
      await chooseOpen(second);
      await openFile(page);
      await ready();
      await mode('reading');
      await zoom(100);
      await layout('fullscreen');
      await page.keyboard.press('ControlOrMeta+-');
      await zoom(90);
      await mode('split');
      await activeTab('阅读布局甲.md').click();
      await ready();
      assert.equal(await page.locator('#desktop-app').getAttribute('data-mode'), 'source');
      assert.equal(await page.locator('#reader').isVisible(), false);
      await mode('reading');
      await zoom(125);
      assert.equal(await page.locator('#markdown-page').evaluate(node => getComputedStyle(node).maxWidth), '680px');
      assert.ok(Math.abs(await top() - position) < 3);
      await mode('source');
      await app.close();
      await launch();
      await ready();
      assert.equal(await page.locator('#desktop-app').getAttribute('data-mode'), 'source');
      assert.equal(await page.locator('#editor-pane').isVisible(), true);
      await mode('reading');
      await zoom(125);
      assert.equal(await page.locator('#markdown-page').evaluate(node => getComputedStyle(node).maxWidth), '680px');
      assert.ok(Math.abs(await top() - position) < 3);
      await activeTab('阅读布局乙.md').click();
      await ready();
      assert.equal(await page.locator('#desktop-app').getAttribute('data-mode'), 'split');
      await zoom(90);
      assert.equal(await page.locator('#markdown-page').evaluate(node => getComputedStyle(node).maxWidth), '100%');
      const resize = (width, minimum) => app.evaluate(({ BrowserWindow }, { width, minimum }) => {
        const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'));
        main.setMinimumSize(minimum, 640);
        main.setContentSize(width, 760);
      }, { width, minimum });
      await resize(600, 560);
      await page.waitForFunction(() => document.getElementById('desktop-app').dataset.mode === 'source');
      await resize(1120, 960);
      await page.waitForFunction(() => document.getElementById('desktop-app').dataset.mode === 'split');
      await activeTab('阅读布局甲.md').click();
      await ready();
      assert.equal(await page.locator('#desktop-app').getAttribute('data-mode'), 'reading');
    });

    await t.test('native fullscreen toggles independently of focus mode, layout and document zoom', async () => {
      await page.locator('#desktop-toolbar [data-shell-action="focus"]').click();
      await page.click('[data-shell-action="view-menu"]');
      await page.click('#fullscreen-toggle');
      await page.waitForFunction(() => document.getElementById('fullscreen-toggle').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.evaluate(() => window.desktop.fullscreen('get')), true);
      await zoom(125);
      assert.equal(await page.locator('#desktop-app').evaluate(node => node.classList.contains('focus-mode')), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.desktop.fullscreen('get')), true);
      assert.equal(await page.locator('#desktop-app').evaluate(node => node.classList.contains('focus-mode')), false);
      await page.keyboard.press('F11');
      await page.waitForFunction(() => document.getElementById('fullscreen-toggle').getAttribute('aria-pressed') === 'false');
      assert.equal(await page.evaluate(() => window.desktop.fullscreen('get')), false);
      assert.equal(await page.locator('#markdown-page').evaluate(node => getComputedStyle(node).maxWidth), '680px');
    });

    await t.test('a narrow zoomed preview and source mode export the same PDF layout as ordinary reading', async () => {
      await layout('normal');
      await page.keyboard.press('ControlOrMeta+0');
      await zoom(100);
      const ordinary = await pdfSnapshot(path.join(folder, '普通.pdf'));
      await layout('narrow');
      for (let step = 0; step < 5; step++) await page.keyboard.press('ControlOrMeta+=');
      await zoom(200);
      await page.screenshot({ path: path.join(artifacts, 'narrow-200.png'), scale: 'css' });
      assert.equal(await page.locator('#reader').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await mode('source');
      const fromSource = await pdfSnapshot(path.join(folder, '源码.pdf'));
      assert.deepEqual(fromSource, ordinary);
      assert.equal(await fs.readFile(first, 'utf8'), long);
      assert.deepEqual(errors, []);
    });
  } finally {
    if (app) await app.close();
  }
});
