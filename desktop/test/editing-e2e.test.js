import { openFile, openWorkspace, exportFile, cancelExport, openSettings, closeDialogs, selectNav, documentMenu } from './ui-helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { _electron } from 'playwright-core';
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.desktopEditor) && !document.querySelector('#open').disabled, { timeout: 30000 });
}
async function heading(page, text) { await page.waitForFunction(expected => document.querySelector('#markdown-content h1')?.textContent === expected && !document.querySelector('#open').disabled, text, { timeout: 15000 }); }

test('real editing, external changes and conflict-safe saves preserve user content', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'editing');
  await fs.mkdir(artifacts, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(artifacts, 'run-')); const folder = path.join(temporary, '我的笔记'); await fs.mkdir(folder);
  const a = path.join(folder, 'A.md'), b = path.join(folder, 'B.md');
  const long = Array.from({ length: 100 }, (_, i) => `## 段落 ${i}\r\n\r\n长文正文。\r\n\r\n`).join('');
  await fs.writeFile(a, '\uFEFF# 初始版本\r\n\r\n' + long); await fs.writeFile(b, '# B 原文');
  const packaged = process.env.MV_DESKTOP_EXECUTABLE;
  const app = await _electron.launch({ executablePath: packaged || require('electron'),
    args: [`--user-data-dir=${path.join(temporary, 'profile')}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  const page = await app.firstWindow(); await ready(page);
  const edit = async text => { await page.fill('#markdown-editor', text); await page.waitForFunction(value => window.desktopCodeEditor.getText() === value, text); await page.evaluate('window.desktopEditor.flush()'); };
  const chooseSave = async filePath => app.evaluate(({ dialog }, selected) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected }); }, filePath);
  const chooseDiscard = async response => app.evaluate(({ dialog }, value) => { dialog.showMessageBox = async () => ({ response: value }); }, response);
  try {
    await chooseDiscard(0);
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, folder);
    await openWorkspace(page); await ready(page);
    await page.locator('.tree-file[data-name="B.md"]').click(); await ready(page);
    await page.locator('.tree-file[data-name="A.md"]').click(); await ready(page);
    await t.test('refreshes external writes and pauses without changing the current reading position', async () => {
      await page.evaluate('document.getElementById("reader").scrollTo({top:1400, behavior:"instant"})');
      await page.waitForFunction(() => document.getElementById("reader").scrollTop > 1300); const position = await page.evaluate('document.getElementById("reader").scrollTop');
      await fs.writeFile(a, '\uFEFF# 外部版本二\r\n\r\n' + long); await heading(page, '外部版本二');
      assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - position) < 3);
      await page.uncheck('#auto-refresh');
      await fs.writeFile(a, '\uFEFF# 外部版本三\r\n\r\n' + long);
      await page.waitForFunction(() => document.querySelector('#file-status').textContent.includes('磁盘'));
      assert.equal(await page.locator('#markdown-content h1').innerText(), '外部版本二');
      await page.check('#auto-refresh'); await heading(page, '外部版本三');
      assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - position) < 3);
    });
    await t.test('keeps a draft across tabs, previews it and saves with the original encoding format', async () => {
      await page.click('#edit-toggle');
      const original = await fs.readFile(a, 'utf8');
      await edit('# 我的编辑\n\n尚未写入磁盘。\n');
      assert.equal(await fs.readFile(a, 'utf8'), original);
      assert.equal(await page.locator('#pdf').isDisabled(), true, 'stale preview cannot export a different draft');
      await page.locator('.tab-open', { hasText: 'B.md' }).click(); await ready(page);
      await page.locator('.tab-open', { hasText: 'A.md' }).click(); await ready(page);
      assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'), '# 我的编辑\n\n尚未写入磁盘。\n');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '我的编辑');
      const stale = await page.evaluate('window.desktop.session().then(r => r.selected)');
      await edit('# 我的编辑\n\n更新后的正文。\n');
      assert.equal(await page.evaluate(payload => window.desktop.save(payload).then(() => false, () => true), { documentId: stale.documentId, revision: stale.revision, saveAs: false }), true);
      await page.click('#save'); await ready(page);
      assert.match(await page.locator('#status').innerText(), /已保存/);
      assert.equal(await fs.readFile(a, 'utf8'), '\uFEFF# 我的编辑\r\n\r\n更新后的正文。\r\n');
      assert.equal(await page.locator('#save').isDisabled(), true);
    });
    await t.test('refuses external conflicts and only reloads a dirty draft after explicit discard', async () => {
      await edit('# 本地未保存\n\n不能被刷新覆盖。');
      await fs.writeFile(a, '# 外部冲突版本\n\n保留磁盘正文。');
      await page.waitForFunction(() => document.querySelector('#file-status').textContent.includes('磁盘'));
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /本地未保存/);
      await page.click('#save'); await ready(page);
      assert.match(await page.locator('#status').innerText(), /SAVE_CONFLICT/);
      assert.match(await fs.readFile(a, 'utf8'), /外部冲突版本/);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /本地未保存/);
      await documentMenu(page, '#reload-file'); await ready(page);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /本地未保存/);
      await chooseDiscard(1); await documentMenu(page, '#reload-file'); await ready(page);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '外部冲突版本');
      assert.equal(await page.locator('#save').isDisabled(), true); await chooseDiscard(0);
    });
    let copy;
    await t.test('canceling Save As retains the draft and another opened source cannot be overwritten', async () => {
      await edit('# 另存的编辑稿\n\n与源文件分开保存。');
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
      await closeDialogs(page); await page.click('[data-shell-action="file-menu"]'); await page.click('#save-as'); await ready(page); assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /另存的编辑稿/);
      await chooseSave(b); await closeDialogs(page); await page.click('[data-shell-action="file-menu"]'); await page.click('#save-as'); await ready(page);
      assert.match(await page.locator('#status').innerText(), /Cannot overwrite/); assert.equal(await fs.readFile(b, 'utf8'), '# B 原文');
      await page.click('#preview-draft'); await ready(page);
      await page.screenshot({ path: path.join(artifacts, 'editor.png') });
      copy = path.join(temporary, '另存 副本.md'); await chooseSave(copy); await closeDialogs(page); await page.click('[data-shell-action="file-menu"]'); await page.click('#save-as'); await ready(page);
      assert.equal(await fs.readFile(copy, 'utf8'), '# 另存的编辑稿\n\n与源文件分开保存。');
      assert.match(await fs.readFile(a, 'utf8'), /外部冲突版本/);
      assert.equal(await page.locator('.document-tab').count(), 2);
      assert.equal(await page.locator('.tab-open', { hasText: 'A.md' }).count(), 0);
    });
    await t.test('canceling dirty tab, workspace and window closure retains the edit', async () => {
      await page.locator('.tab-open', { hasText: 'B.md' }).click(); await ready(page); await edit('# B 未保存');
      await page.locator('.document-tab', { has: page.locator('.tab-open[aria-selected="true"]') }).locator('.tab-close').click(); await ready(page);
      assert.equal(await page.locator('.document-tab').count(), 2);
      await page.locator('.workspace-close').click(); await ready(page);
      assert.equal(await page.locator('#workspaces section').count(), 1);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).close());
      await page.waitForTimeout(300);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /B 未保存/);
      assert.equal(await fs.readFile(b, 'utf8'), '# B 原文');
      await chooseDiscard(1);
      await page.locator('.document-tab', { has: page.locator('.tab-open[aria-selected="true"]') }).locator('.tab-close').click(); await ready(page);
      assert.equal(await page.locator('.document-tab').count(), 1); await chooseDiscard(0);
    });
    await t.test('an export keeps its pre-edit snapshot while the source draft changes', async () => {
      const output = path.join(artifacts, 'pre-edit-snapshot.pdf');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = () => new Promise(resolve => { globalThis.__finishEditingExport = () => resolve({ canceled: false, filePath }); });
      }, output);
      await exportFile(page, 'pdf');
      for (let i = 0; i < 100 && !await app.evaluate(() => typeof globalThis.__finishEditingExport === 'function'); i++) await page.waitForTimeout(20);
      await edit('# Changed after export\n\nNew draft body.'); await page.click('#preview-draft'); await ready(page);
      await app.evaluate(() => { globalThis.__finishEditingExport(); delete globalThis.__finishEditingExport; });
      await page.waitForFunction(() => document.querySelector('#cancel-export').disabled, { timeout: 90000 });
      assert.match(await page.locator('#status').innerText(), /已保存/);
      const loading = getDocument({ data: new Uint8Array(await fs.readFile(output)), useSystemFonts: true });
      const pdf = await loading.promise;
      try {
        const content = await (await pdf.getPage(1)).getTextContent(); const text = content.items.map(item => item.str || '').join('');
        assert.match(text, /另存的编辑稿/); assert.doesNotMatch(text, /Changed after export/);
      } finally { await loading.destroy(); }
      assert.match(await fs.readFile(copy, 'utf8'), /另存的编辑稿/);
    });
    await t.test('a deleted dirty source stays recoverable via Save As', async () => {
      await fs.rm(copy);
      await page.waitForFunction(() => document.querySelector('#file-status').textContent.includes('磁盘'));
      await page.click('#save'); await ready(page); assert.match(await page.locator('#status').innerText(), /SAVE_CONFLICT/);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /Changed after export/);
      const recovered = path.join(temporary, '恢复.md'); await chooseSave(recovered);
      await closeDialogs(page); await page.click('[data-shell-action="file-menu"]'); await page.click('#save-as'); await ready(page);
      assert.match(await fs.readFile(recovered, 'utf8'), /Changed after export/);
      assert.equal(await page.locator('#save').isDisabled(), true);
      assert.deepEqual((await fs.readdir(temporary)).filter(name => name.endsWith('.tmp')), []);
    });
    await t.test('replacing a selected directory cannot redirect a draft save outside its original scope', async () => {
      const selected = path.join(temporary, 'selected'); const outside = path.join(temporary, 'outside');
      await fs.mkdir(selected); await fs.mkdir(outside);
      const file = path.join(selected, 'X.md'); await fs.writeFile(file, '# selected');
      const target = path.join(outside, 'X.md'); await fs.writeFile(target, '# untouched outside');
      await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
      await openFile(page); await ready(page); await edit('# draft survives replacement');
      await fs.rename(selected, path.join(temporary, 'selected-moved'));
      await fs.symlink(outside, selected, process.platform === 'win32' ? 'junction' : 'dir');
      await page.click('#save'); await ready(page);
      assert.match(await page.locator('#status').innerText(), /replaced|outside/);
      assert.equal(await fs.readFile(target, 'utf8'), '# untouched outside');
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'), /draft survives/);
      const recovery = path.join(temporary, '保留编辑稿.md'); await chooseSave(recovery);
      await closeDialogs(page); await page.click('[data-shell-action="file-menu"]'); await page.click('#save-as'); await ready(page);
      assert.equal(await fs.readFile(recovery, 'utf8'), '# draft survives replacement');
    });
    await t.test('an invalid UTF-8 selection leaves the active document and registered tabs intact', async () => {
      const invalid = path.join(temporary, '不支持的编码.md'); await fs.writeFile(invalid, Buffer.from([0xff, 0xfe]));
      const before = await page.evaluate('window.desktop.session()');
      await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, invalid);
      await openFile(page); await ready(page);
      assert.match(await page.locator('#status').innerText(), /UTF-8/);
      const after = await page.evaluate('window.desktop.session()');
      assert.equal(after.selected.documentId, before.selected.documentId);
      assert.deepEqual(after.tabs, before.tabs);
      assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'), '# draft survives replacement');
    });
  } finally {
    await chooseDiscard(1);
    await app.close();
  }
});
