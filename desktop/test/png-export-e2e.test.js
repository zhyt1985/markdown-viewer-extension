import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '../node_modules/@napi-rs/canvas/index.js';
import { cancelExport, exportFile, launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const colors = { start: [223, 25, 48], table: [20, 190, 75], end: [23, 90, 214], diagram: [185, 62, 225] };

function marker(rgb) {
  const canvas = createCanvas(22, 18);
  const context = canvas.getContext('2d');
  context.fillStyle = `rgb(${rgb.join(',')})`;
  context.fillRect(0, 0, 22, 18);
  return canvas.toBuffer('image/png');
}

async function scanPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const found = Object.fromEntries(Object.keys(colors).map(name => [name, null]));
  const byColor = new Map(Object.entries(colors).map(([name, [r, g, b]]) => [r << 16 | g << 8 | b, name]));
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const offset = (y * image.width + x) * 4;
      const name = byColor.get(data[offset] << 16 | data[offset + 1] << 8 | data[offset + 2]);
      if (name && data[offset + 3] === 255) found[name] ||= { x, y };
    }
  }
  return { width: image.width, height: image.height, found };
}

test('desktop saves a full document PNG without cropping the foreground viewport', { timeout: 150000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'png-export');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const input = path.join(folder, '长文 #%.md');
  const tooTall = path.join(folder, '过长.md');
  const other = path.join(folder, '另一文档.md');
  const columns = Array.from({ length: 12 }, (_, index) => `Column${index + 1}`);
  const tableRow = [...columns.slice(0, -1).map((_, index) => `VeryLongUnbrokenCell${index + 1}`.repeat(5)), '![last column](./table.png)'];
  const table = [columns, columns.map(() => '---'), tableRow].map(row => `| ${row.join(' | ')} |`).join('\n');
  const paragraphs = Array.from({ length: 300 }, (_, index) => `第 ${index + 1} 段：用于验证完整的文档布局和长图输出。`).join('\n\n');
  const source = `# 长文 PNG 验证\n\n![top](./start.png)\n\n${table}\n\n` +
    '```text\n' + 'LongUnbrokenCodeToken'.repeat(80) + '\n```\n\n' + paragraphs +
    '\n\n```mermaid\nflowchart LR\n  A[Offline] --> B[Full document]\n  style B fill:#b93ee1,stroke:#b93ee1\n```\n\n![last block](./end.png)\n';
  await Promise.all([
    fs.writeFile(input, source),
    fs.writeFile(other, '# Another document'),
    fs.writeFile(tooTall, '# 超过高度上限\n\n```text\n' + 'A line of fixed-width text.\n'.repeat(1080) + '```\n'),
    ...['start', 'table', 'end'].map(name => fs.writeFile(path.join(folder, `${name}.png`), marker(colors[name]))),
  ]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    const ready = (name = null) => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null || state.document?.filename === name);
    }, name);
    const status = () => page.locator('#status').innerText();
    const savePicker = filePath => app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, filePath);
    const settled = () => page.waitForFunction(() => !window.desktopApp.state().exporting, null, { timeout: 45000 });
    async function pick(file) {
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
      await openFile(page); await ready(path.basename(file));
    }
    const activate = async file => {
      await page.locator('.tab-open', { hasText: path.basename(file) }).click(); await ready(path.basename(file));
    };
    await ready(); await pick(input);

    await t.test('captures the first block, wide table, diagram, and last block on one PNG', async () => {
      const output = path.join(folder, '整页.png');
      await page.locator('#reader').evaluate(node => { node.scrollTop = 720; });
      const position = await page.locator('#reader').evaluate(node => node.scrollTop);
      const before = await page.locator('#markdown-content').innerHTML();
      assert.ok(position > 600);
      assert.equal(await page.locator('#export-open').isEnabled(), true, await status());
      await savePicker(output);
      await page.click('#export-open');
      await page.click('[data-export-format="png"]');
      assert.match(await page.locator('#export-png-note').innerText(), /1440.*16,000/);
      await page.click('#export-start'); await settled();
      assert.match(await status(), /已保存/);
      const { width, height, found } = await scanPng(await fs.readFile(output));
      assert.equal(width, 1440);
      assert.ok(height > 10500 && height <= 16000, `Unexpected height ${height}`);
      assert.ok(found.start && found.start.y < 230, JSON.stringify(found));
      assert.ok(found.table && found.table.x > width * 0.65 && found.table.y > found.start.y, JSON.stringify(found));
      assert.ok(found.diagram && found.diagram.y > height * 0.8, JSON.stringify(found));
      assert.ok(found.end && found.end.y > found.diagram.y && found.end.y > height - 180, JSON.stringify(found));
      assert.equal(await page.locator('#reader').evaluate(node => node.scrollTop), position);
      assert.equal(await page.locator('#markdown-content').innerHTML(), before);
    });

    await t.test('switching tabs while saving preserves the original PNG snapshot', async () => {
      const output = path.join(folder, '原文快照.png');
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = () => new Promise(resolve => { globalThis.finishPng = resolve; }); });
      await exportFile(page, 'png');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await pick(other);
      await app.evaluate((_electron, filePath) => { globalThis.finishPng({ canceled: false, filePath }); }, output);
      await settled();
      assert.match(await status(), /已保存/);
      const png = await scanPng(await fs.readFile(output));
      assert.ok(png.found.start && png.found.end);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Another document');
    });

    await t.test('height limits, missing images, and cancellation do not create a partial PNG', async () => {
      const output = path.join(folder, '未写出.png');
      await pick(tooTall);
      await savePicker(output);
      await exportFile(page, 'png'); await settled();
      assert.match(await status(), /超过 16000 像素上限.*PDF/);
      await assert.rejects(fs.access(output), { code: 'ENOENT' });
      await activate(input);
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = () => new Promise(resolve => { globalThis.finishPng = resolve; }); });
      await exportFile(page, 'png');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await cancelExport(page);
      await app.evaluate((_electron, filePath) => { globalThis.finishPng({ canceled: false, filePath }); }, output);
      await settled();
      assert.match(await status(), /已取消导出/);
      await assert.rejects(fs.access(output), { code: 'ENOENT' });
      await fs.rename(path.join(folder, 'end.png'), path.join(folder, 'moved.png'));
      await savePicker(output);
      await exportFile(page, 'png'); await settled();
      assert.match(await status(), /操作失败.*last block/);
      await assert.rejects(fs.access(output), { code: 'ENOENT' });
      assert.equal(await fs.readFile(input, 'utf8'), source);
    });
  } finally { await app.close(); }
});
