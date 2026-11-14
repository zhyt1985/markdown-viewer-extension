import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop table menu copies HTML and TSV and exports a styled XLSX with real merges', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'table-context-menu');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const source = path.join(folder, '表格.md');
  const other = path.join(folder, '其他.md');
  const output = path.join(folder, '合并表.xlsx');
  const markdown = `# 表格文档

## 季度数据

| 类别 | 品牌 | 金额 |
| --- | --- | --- |
| 电子产品 | | |
| 手机 | 苹果 | 007 |
| | | 42 |
| | 安卓 | =1+1 |
| 办公用品 | | |
| 文具 | 笔 | -3 |
| | | 圆珠笔 |

## 附图

| 图 | 说明 |
| --- | --- |
| ![图标](./icon.png) | 附图测试 |
`;
  await Promise.all([fs.writeFile(source, markdown), fs.writeFile(other, '# Another document\n'),
    fs.copyFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'), path.join(folder, 'icon.png'))]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const ready = name => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null ? !state.document : state.document?.filename === name && state.preview.current);
    }, name);
    await app.evaluate(({ clipboard, dialog }) => {
      clipboard.write = value => { globalThis.__tableClipboard = value; };
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.__tableSaveOptions = options;
        const filePath = globalThis.__tableDestination;
        return { canceled: !filePath, filePath };
      };
    });
    async function pick(file) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await openFile(page);
      await ready(path.basename(file));
    }
    const table = page.locator('#markdown-content table').first();
    const menu = page.locator('#shell-popover [data-shell-menu="table"]');
    const item = action => menu.locator(`[data-table-action="${action}"]`);
    const status = text => page.waitForFunction(text => document.getElementById('status').textContent.includes(text), text);
    async function openMenu() {
      await table.locator('th').first().click({ button: 'right' });
      await menu.waitFor();
    }
    async function save(file, message) {
      await app.evaluate((_electron, file) => { globalThis.__tableDestination = file; }, file);
      await openMenu();
      await item('save').click();
      await status(message);
    }
    await ready(null);
    await pick(other);
    await pick(source);
    assert.equal(await table.locator('[colspan="3"]').first().textContent(), '电子产品');
    assert.equal(await table.locator('[rowspan="3"]').textContent(), '手机');

    await t.test('clipboard HTML and TSV keep the same rectangular grid, with literal formula text', async () => {
      await openMenu();
      await item('copy').click();
      await status('已将表格复制到剪贴板');
      const clipboard = await app.evaluate(() => globalThis.__tableClipboard);
      const grid = [['类别', '品牌', '金额'], ['电子产品', '', ''], ['手机', '苹果', '007'], ['', '', '42'],
        ['', '安卓', "'=1+1"], ['办公用品', '', ''], ['文具', '笔', '-3'], ['', '', '圆珠笔']];
      assert.deepEqual(clipboard.text.split('\n').map(row => row.split('\t')), grid);
      const html = await page.evaluate(value => {
        const table = new DOMParser().parseFromString(value, 'text/html').querySelector('table');
        return { rows: Array.from(table.rows, row => Array.from(row.cells, cell => cell.textContent)),
          hasSpans: Boolean(table.querySelector('[rowspan],[colspan]')),
          header: table.querySelector('th')?.getAttribute('style') };
      }, clipboard.html);
      assert.deepEqual(html.rows, grid);
      assert.equal(html.hasSpans, false);
      assert.match(html.header, /border:1px solid #[0-9a-f]{6}.*font-weight:bold/i);
      await fs.writeFile(path.join(folder, 'clipboard.json'), JSON.stringify(clipboard));
    });

    await t.test('workbook contains merge ranges, native numbers, literal strings and header styling', async () => {
      await save(output, '已保存表格');
      const options = await app.evaluate(() => globalThis.__tableSaveOptions);
      assert.equal(path.basename(options.defaultPath), '季度数据.xlsx');
      assert.deepEqual(options.filters[0].extensions, ['xlsx']);
      const workbook = await JSZip.loadAsync(await fs.readFile(output), { checkCRC32: true });
      const sheet = await workbook.file('xl/worksheets/sheet1.xml').async('string');
      const styles = await workbook.file('xl/styles.xml').async('string');
      assert.match(await workbook.file('xl/workbook.xml').async('string'), /<sheet name="Sheet1"/);
      assert.match(sheet, /<dimension ref="A1:C8"/);
      assert.match(sheet, /<mergeCell ref="A2:C2"/);
      assert.match(sheet, /<mergeCell ref="A3:A5"/);
      assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">类别</);
      assert.match(sheet, /<c r="C3" t="inlineStr"><is><t xml:space="preserve">007</);
      assert.match(sheet, /<c r="C4"><v>42<\/v>/);
      assert.match(sheet, /<c r="C5" t="inlineStr"><is><t xml:space="preserve">=1\+1</);
      assert.doesNotMatch(sheet, /<f[ >]/);
      assert.match(styles, /<font><b\/>/);
      assert.match(styles, /patternType="solid"/);
    });

    await t.test('keyboard navigation, cancel, image priority and tab changes leave the reader intact', async () => {
      const anchor = table.locator('..');
      await anchor.focus();
      await page.keyboard.press('Shift+F10');
      await menu.waitFor();
      assert.equal(await item('copy').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('ArrowDown');
      assert.equal(await item('save').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await anchor.evaluate(node => node === document.activeElement), true);
      await save(null, '已取消导出');
      await save(path.join(folder, '错误.csv'), '请选择 .xlsx 文件名');
      await assert.rejects(fs.stat(path.join(folder, '错误.csv')), { code: 'ENOENT' });
      const image = page.locator('#markdown-content table').nth(1).locator('img');
      await image.evaluate(img => img.decode());
      await image.click({ button: 'right' });
      await page.locator('#shell-popover [data-shell-menu="image"]').waitFor();
      await page.keyboard.press('Escape');
      await openMenu();
      await page.evaluate(() => {
        const state = window.desktopApp.state();
        return window.desktopApp.activate(state.tabs.find(tab => tab.documentId !== state.document.documentId).documentId);
      });
      await ready(path.basename(other));
      await menu.waitFor({ state: 'hidden' });
      assert.equal(await fs.readFile(source, 'utf8'), markdown);
    });
  } finally { await app.close(); }
});
