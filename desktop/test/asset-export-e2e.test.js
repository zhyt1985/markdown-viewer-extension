import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '../node_modules/@napi-rs/canvas/index.js';
import { closeDialogs, documentMenu, launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop exports document assets by index, type and source line even with failed rows', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'asset-export');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const output = path.join(folder, '输出');
  const markdown = path.join(folder, '资产 #%.md');
  const other = path.join(folder, '其他.md');
  const png = await fs.readFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'));
  const canvas = createCanvas(48, 48);
  canvas.getContext('2d').drawImage(await loadImage(png), 0, 0);
  const jpg = canvas.toBuffer('image/jpeg');
  const source = '# Asset test\n\n![Original PNG](./logo.png)\n\n![Original JPEG](./照片%20%23.jpg)\n\n'
    + '```mermaid\nflowchart LR\nA --> B\n```\n\n![Missing image](./missing.png)\n\n'
    + '```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n\n```dot\ndigraph { A -> }\n```\n';
  const lines = ['![Original PNG]', '![Original JPEG]', '```mermaid', '![Missing image]', '```plantuml', '```dot']
    .map(prefix => source.split('\n').findIndex(line => line.startsWith(prefix)) + 1);
  await Promise.all([fs.mkdir(output), fs.writeFile(markdown, source), fs.writeFile(other, '# Other tab'),
    fs.writeFile(path.join(folder, 'logo.png'), png), fs.writeFile(path.join(folder, '照片 #.jpg'), jpg)]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    const ready = name => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null || state.document?.filename === name);
    }, name);
    const row = index => page.locator(`#asset-rows li[data-index="${index}"]`);
    const outputDirectories = () => fs.readdir(output);
    const setPicker = file => app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: !file, filePaths: file ? [file] : [] });
    }, file);
    async function pick(file) { await setPicker(file); await openFile(page); await ready(path.basename(file)); }
    async function openAssets() {
      await documentMenu(page, '#asset-open');
      await page.locator('#asset-rows li').first().waitFor();
    }
    async function exportSelection() {
      const before = await outputDirectories();
      await setPicker(output);
      await page.click('#asset-save');
      await page.waitForFunction(() => !window.desktopApp.state().exporting);
      assert.match(await page.locator('#asset-status').innerText(), /已保存/);
      const added = (await outputDirectories()).filter(name => !before.includes(name));
      assert.equal(added.length, 1);
      const dir = path.join(output, added[0]);
      return { dir, manifest: JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) };
    }
    await ready(null);
    await pick(markdown);
    assert.equal(await page.locator('#export-open').isDisabled(), true, 'normal document export is disabled on render errors');

    await t.test('lists numbered rows, source locations, unavailable items and real format choices', async () => {
      await openAssets();
      assert.deepEqual(await page.locator('#asset-rows li').evaluateAll(rows => rows.map(row => Number(row.dataset.index))), [1,2,3,4,5,6]);
      for (const [index, line] of lines.entries()) assert.match(await row(index + 1).innerText(), new RegExp(`第 ${line} 行`));
      assert.match(await row(4).locator('.asset-error').innerText(), /Missing image/);
      assert.ok((await row(6).locator('.asset-error').innerText()).length > 0);
      assert.equal(await row(4).locator('input').isDisabled(), true);
      assert.deepEqual(await row(1).locator('option').evaluateAll(items => items.map(item => item.value)), ['original']);
      assert.deepEqual(await row(3).locator('option').evaluateAll(items => items.map(item => item.value)), ['png', 'svg']);
      assert.ok((await row(5).locator('option').evaluateAll(items => items.map(item => item.value))).includes('drawio'));
    });

    await t.test('filters by kind, index and line and writes only the selected files with stable names', async () => {
      await page.selectOption('#asset-kind', 'image');
      assert.equal(await page.locator('#asset-rows li').count(), 3);
      await page.fill('#asset-index', '2');
      await page.fill('#asset-line', String(lines[0]));
      assert.equal(await page.locator('#asset-rows li').count(), 0);
      await page.fill('#asset-line', String(lines[1]));
      assert.equal(await page.locator('#asset-rows li').count(), 1);
      const { dir, manifest } = await exportSelection();
      assert.deepEqual(manifest.saved.map(item => item.index), [2]);
      assert.deepEqual(await fs.readFile(path.join(dir, '002-image.jpg')), jpg);
      assert.deepEqual(manifest.failed.map(item => item.index), [4,6]);
      await page.selectOption('#asset-kind', 'diagram');
      await page.fill('#asset-index', ''); await page.fill('#asset-line', '');
      await row(3).locator('select').selectOption('svg');
      await row(5).locator('select').selectOption('drawio');
      const figures = await exportSelection();
      assert.deepEqual(figures.manifest.saved.map(item => item.index), [3,5]);
      assert.match(await fs.readFile(path.join(figures.dir, '003-mermaid.svg'), 'utf8'), /<svg\b/);
      assert.match(await fs.readFile(path.join(figures.dir, '005-plantuml.drawio'), 'utf8'), /<mx(?:file|GraphModel)\b/);
    });

    await t.test('exports all usable assets with original image bytes and a report of missing items', async () => {
      await page.selectOption('#asset-kind', '');
      await row(3).locator('select').selectOption('png');
      await row(5).locator('select').selectOption('png');
      await page.click('#asset-select');
      const { dir, manifest } = await exportSelection();
      assert.deepEqual(manifest.saved.map(item => item.index), [1,2,3,5]);
      assert.deepEqual(await fs.readFile(path.join(dir, '001-image.png')), png);
      assert.equal((await fs.readFile(path.join(dir, '003-mermaid.png'))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual(manifest.failed.map(item => item.line), [lines[3], lines[5]]);
      assert.equal(await fs.readFile(markdown, 'utf8'), source);
    });

    await t.test('canceling leaves no batch and switching tabs keeps the original selection', async () => {
      const before = await outputDirectories();
      await setPicker(null);
      await page.click('#asset-save');
      await page.waitForFunction(() => !window.desktopApp.state().exporting);
      assert.match(await page.locator('#asset-status').innerText(), /已取消导出/);
      assert.deepEqual(await outputDirectories(), before);
      await page.fill('#asset-index', '1');
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = () => new Promise(resolve => { globalThis.finishAssetExport = resolve; }); });
      await page.click('#asset-save');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await closeDialogs(page);
      await pick(other);
      await app.evaluate((_electron, file) => { globalThis.finishAssetExport({ canceled: false, filePaths: [file] }); }, output);
      await page.waitForFunction(() => !window.desktopApp.state().exporting);
      const added = (await outputDirectories()).filter(name => !before.includes(name));
      assert.equal(added.length, 1);
      assert.deepEqual(await fs.readFile(path.join(output, added[0], '001-image.png')), png);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Other tab');
    });
  } finally { await app.close(); }
});
