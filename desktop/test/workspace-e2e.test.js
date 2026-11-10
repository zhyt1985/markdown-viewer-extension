import { openFile, openWorkspace, exportFile, cancelExport, openSettings, closeDialogs, selectNav, documentMenu } from './ui-helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { _electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));
async function wait(page, expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!await page.evaluate(expression)) {
    if (Date.now() > end) throw Error(`Timed out: ${expression}; ${await page.locator('#status').innerText()}`);
    await page.waitForTimeout(50);
  }
}

test('real workspace tree, tabs, reading state and export remain correctly scoped', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'workspace');
  await fs.mkdir(artifacts, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const folder = path.join(temporary, '本地 工作区');
  await fs.mkdir(path.join(folder, '章节'), { recursive: true }); await fs.mkdir(path.join(folder, '图片'));
  const a = path.join(folder, '章节', 'A.md'); const b = path.join(folder, 'B.md');
  const aText = '# 工作区 A\n\n![图](../图片/local.svg)\n\n' + Array.from({ length: 100 }, (_, i) => `## 第 ${i} 段\n\n这是 A 文档的长正文。\n\n`).join('');
  await fs.writeFile(a, aText); await fs.writeFile(b, '# 工作区 B\n\n另一份本地文档');
  await fs.writeFile(path.join(folder, '图片', 'local.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>');
  await fs.writeFile(path.join(folder, 'unsupported.bin'), Buffer.from([0, 1, 2]));
  const packaged = process.env.MV_DESKTOP_EXECUTABLE;
  const app = await _electron.launch({ executablePath: packaged || require('electron'),
    args: [`--user-data-dir=${path.join(temporary, 'profile')}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow(); await wait(page, 'Boolean(window.desktopViewer && window.desktop)');
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, folder);
    await openWorkspace(page); await wait(page, '!document.querySelector("#open-workspace").disabled');
    const workspaceId = await page.locator('#workspaces section').getAttribute('data-workspace-id');
    await t.test('loads a lazy tree and parent-relative images without duplicating tabs', async () => {
      assert.equal(await page.locator('.tree-file[data-name="A.md"]').count(), 0);
      assert.equal(await page.locator('.tree-file[data-name="unsupported.bin"]').isDisabled(), true);
      await page.locator('.tree-dir[data-name="章节"]').click(); await wait(page, '!document.querySelector("#open").disabled');
      await page.locator('.tree-file[data-name="A.md"]').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.match(await page.locator('#status').innerText(), /预览完成/);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '工作区 A');
      assert.equal(await page.evaluate('document.querySelector("#markdown-content img").naturalWidth > 0'), true);
      await page.locator('.tree-file[data-name="A.md"]').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('.document-tab').count(), 1);
    });
    let savedPosition;
    await t.test('switches tab content and restores independent reading positions', async () => {
      await page.evaluate('document.getElementById("reader").scrollTo({top:1300, behavior:"instant"})'); await wait(page, 'document.getElementById("reader").scrollTop > 1200');
      savedPosition = await page.evaluate('document.getElementById("reader").scrollTop');
      assert.equal(await page.evaluate('Math.round(document.getElementById("desktop-toolbar").getBoundingClientRect().top)'), await page.evaluate('document.getElementById("app-header").getBoundingClientRect().height + document.getElementById("tabs").getBoundingClientRect().height'));
      await page.locator('.tree-file[data-name="B.md"]').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '工作区 B');
      assert.equal(await page.locator('.document-tab').count(), 2);
      await page.locator('.tab-open', { hasText: 'A.md' }).click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '工作区 A');
      const restored = await page.evaluate('document.getElementById("reader").scrollTop');
      assert.ok(Math.abs(restored - savedPosition) < 3, `saved ${savedPosition}, restored ${restored}`);
      await page.locator('.tab-open', { hasText: 'B.md' }).click(); await wait(page, '!document.querySelector("#open").disabled');
      await page.locator('.tab-open', { hasText: 'A.md' }).click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - savedPosition) < 3);
    });
    await t.test('refreshes folder contents and rejects forged or closed entry access', async () => {
      await fs.writeFile(path.join(folder, '新增.md'), '# 新增文件');
      await page.locator('.workspace-refresh').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('.tree-file[data-name="新增.md"]').count(), 1);
      await page.screenshot({ path: path.join(artifacts, 'workspace.png') });
      assert.equal(await page.evaluate(`window.desktop.openWorkspaceFile(${JSON.stringify({ workspaceId, entryId: '../secret.md' })}).then(() => false, () => true)`), true);
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
      await openWorkspace(page); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#workspaces section').count(), 1);
    });
    await t.test('keeps a running export valid after its workspace and all tabs are closed', async () => {
      const output = path.join(artifacts, 'workspace-snapshot.pdf');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = () => new Promise(resolve => { globalThis.__finishWorkspaceSave = () => resolve({ canceled: false, filePath }); });
      }, output);
      const oldResource = await page.evaluate('globalThis.platform.document.toResourceUrl("../图片/local.svg")');
      await exportFile(page, 'pdf');
      for (let i = 0; i < 100 && !await app.evaluate(() => typeof globalThis.__finishWorkspaceSave === 'function'); i++) await page.waitForTimeout(25);
      assert.equal(await app.evaluate(() => typeof globalThis.__finishWorkspaceSave), 'function');
      await page.locator('.workspace-close').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('.document-tab').count(), 0);
      assert.equal(await page.locator('#markdown-content').innerText(), '');
      assert.equal(await page.locator('#workspaces').isVisible(), false);
      assert.equal(await page.evaluate(`fetch(${JSON.stringify(oldResource)}).then(r => r.status)`), 403);
      assert.equal(await page.evaluate(`window.desktop.listWorkspace(${JSON.stringify({ workspaceId })}).then(() => false, () => true)`), true);
      await app.evaluate(() => { globalThis.__finishWorkspaceSave(); delete globalThis.__finishWorkspaceSave; });
      await wait(page, 'document.querySelector("#cancel-export").disabled', 90000);
      assert.match(await page.locator('#status').innerText(), /已保存/);
      assert.equal((await fs.readFile(output)).subarray(0, 5).toString(), '%PDF-');
      assert.equal(await fs.readFile(a, 'utf8'), aText);
    });
    await t.test('opens multiple independent files and closes the active tab safely', async () => {
      // Select the two files explicitly; single-file grants intentionally do not
      // authorize A's parent-relative image, so use two self-contained sources.
      const c = path.join(folder, 'C.md'); await fs.writeFile(c, '# 独立文档 C');
      await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [b, c]);
      await openFile(page); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('.document-tab').count(), 2);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '工作区 B');
      await page.locator('.document-tab', { has: page.locator('.tab-open[aria-selected="true"]') }).locator('.tab-close').click();
      await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '独立文档 C');
      await fs.writeFile(c, '# 已更新的 C');
      await page.locator('.tab-open').click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '已更新的 C');
      await page.screenshot({ path: path.join(artifacts, 'tabs.png'), fullPage: true });
    });
    await t.test('does not follow a replaced source directory when reactivating an existing tab', async () => {
      const selected = path.join(temporary, 'selected'); const outside = path.join(temporary, 'outside');
      await fs.mkdir(selected); await fs.mkdir(outside);
      const file = path.join(selected, 'X.md');
      await fs.writeFile(file, '# 已授权 X'); await fs.writeFile(path.join(outside, 'X.md'), '# 未授权替换内容');
      await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
      await openFile(page); await wait(page, '!document.querySelector("#open").disabled');
      await page.locator('.tab-open', { hasText: 'C.md' }).click(); await wait(page, '!document.querySelector("#open").disabled');
      await fs.rename(selected, path.join(temporary, 'selected-moved'));
      await fs.symlink(outside, selected, process.platform === 'win32' ? 'junction' : 'dir');
      await page.locator('.tab-open', { hasText: 'X.md' }).click(); await wait(page, '!document.querySelector("#open").disabled');
      assert.match(await page.locator('#status').innerText(), /操作失败/);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '已更新的 C');
      assert.doesNotMatch(await page.locator('#markdown-content').innerText(), /未授权替换内容/);
    });
  } finally { await app.close(); }
});
