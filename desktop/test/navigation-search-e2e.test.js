import { launchDesktop, openFile, openWorkspace, exportFile, cancelExport, openSettings, closeDialogs, selectNav, documentMenu } from './ui-helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.desktopViewer && window.desktop) && !document.querySelector('#open').disabled, { timeout: 30000 });
}
test('workspace session, recent files and scoped search work across real restarts', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'navigation');
  await fs.mkdir(artifacts, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const folder = path.join(temporary, '我的工作区'); await fs.mkdir(path.join(folder, '子目录'), { recursive: true });
  const a = path.join(folder, '子目录', '长文.md'); const b = path.join(folder, 'B.md');
  await fs.writeFile(a, '# 重启长文\n\n' + Array.from({ length: 100 }, (_, i) => `## 段落 ${i}\n\n${i === 65 ? '检索命中 NEEDLE' : '用于会话恢复的正文'}\n\n`).join(''));
  await fs.writeFile(b, '# B 文档');
  let app; let page;
  async function launch() {
    const packaged = process.env.MV_DESKTOP_EXECUTABLE;
    app = await launchDesktop({ executablePath: packaged || require('electron'),
      args: [`--user-data-dir=${path.join(temporary, 'profile')}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    page = await app.firstWindow(); await ready(page);
  }
  async function close() {
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).close());
    await closed; app = null;
  }
  async function search(query, mode) {
    await selectNav(page, 'search');
    await page.selectOption('#search-mode', mode); await page.fill('#search-query', query); await page.click('#search-start');
    await page.waitForFunction(() => document.querySelector('#search-cancel').disabled && !document.querySelector('#search-status').textContent.includes('正在'));
  }
  try {
    await launch();
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, folder);
    await openWorkspace(page); await ready(page);
    await page.locator('.tree-file[data-name="B.md"]').click(); await ready(page);
    await page.locator('.tree-dir[data-name="子目录"]').click(); await ready(page);
    await page.locator('.tree-file[data-name="长文.md"]').click(); await ready(page);
    await page.evaluate('document.getElementById("reader").scrollTo({top:1500, behavior:"instant"})');
    await page.waitForFunction(() => document.getElementById("reader").scrollTop > 1400); const position = await page.evaluate('document.getElementById("reader").scrollTop');
    await close(); await launch();
    await t.test('automatically restores roots, both tabs, active content and reading position', async () => {
      assert.equal(await page.locator('#workspaces section').count(), 1);
      assert.equal(await page.locator('.document-tab').count(), 2);
      assert.equal(await page.locator('.tab-open[aria-selected="true"]').innerText(), '长文.md');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '重启长文');
      assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - position) < 3);
      await selectNav(page, 'recent');
      assert.equal(await page.locator('.recent-open').count(), 2);
      await page.locator('.recent-open', { hasText: 'B.md' }).click(); await ready(page);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'B 文档');
      assert.equal(await page.locator('.document-tab').count(), 2);
      assert.equal(await page.evaluate('window.desktop.openRecent("forged").then(() => false, () => true)'), true);
    });
    await t.test('finds nested filenames and text, then locates the source block', async () => {
      await search('长文', 'filename'); assert.equal(await page.locator('.search-result').count(), 1);
      assert.match(await page.locator('.search-result').innerText(), /子目录.*长文.md:1/);
      await search('needle', 'content'); assert.equal(await page.locator('.search-result').count(), 1);
      assert.match(await page.locator('.search-result').innerText(), /:265\n检索命中 NEEDLE/);
      await page.locator('.search-result').click(); await ready(page);
      assert.equal(await page.locator('.search-line-target').innerText(), '检索命中 NEEDLE');
      const targetTop = await page.locator('.search-line-target').evaluate(el => el.getBoundingClientRect().top);
      const chrome = await page.evaluate('document.querySelector("#reader").getBoundingClientRect().top');
      assert.ok(Math.abs(targetTop - chrome - 12) < 3);
      await page.screenshot({ path: path.join(artifacts, 'search.png') });
      // Hold a genuine content read so progress and cancellation can be checked independently.
      // This is a test-only monkeypatch, not a product hook.
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises'); const original = fs.open;
        const held = new Promise(resolve => { globalThis.__releaseSearchRead = resolve; });
        let started, closed, claimed = false;
        globalThis.__searchReadStarted = new Promise(resolve => { started = resolve; });
        globalThis.__searchReadClosed = new Promise(resolve => { closed = resolve; });
        fs.open = async (...args) => {
          if (claimed || typeof args[0] !== 'string' || !/(?:B|长文)\.md$/.test(args[0]) || args[1] !== 'r') return original(...args);
          claimed = true; started(); await held;
          const handle = await original(...args);
          const close = handle.close.bind(handle);
          handle.close = async (...options) => { try { await close(...options); } finally { closed(); } };
          return handle;
        };
        globalThis.__restoreSearchRead = () => { fs.open = original; globalThis.__releaseSearchRead(); };
      });
      try {
        await page.fill('#search-query', '正文'); await page.click('#search-start');
        await app.evaluate(() => globalThis.__searchReadStarted);
        await page.waitForFunction(() => /^正在检索 · 已扫描 \d+ 个 Markdown 文件/.test(document.getElementById('search-status').textContent));
        await page.click('#search-cancel');
        assert.equal(await page.locator('#search-status').innerText(), '已取消检索');
        assert.equal(await page.locator('.search-result').count(), 0);
        // A newer search can finish while the canceled read is still held.
        await search('B.md', 'filename');
        assert.equal(await page.locator('.search-result').count(), 1);
      } finally {
        await app.evaluate(() => { globalThis.__restoreSearchRead(); delete globalThis.__restoreSearchRead; delete globalThis.__releaseSearchRead; });
      }
      await app.evaluate(() => globalThis.__searchReadClosed);
      assert.match(await page.locator('.search-result').innerText(), /B\.md:1/);
    });
    await t.test('skips missing files on restart and clearing history keeps open documents', async () => {
      await close(); await fs.rm(b); await launch();
      assert.equal(await page.locator('.document-tab').count(), 1);
      assert.match(await page.locator('#session-status').innerText(), /文档未恢复.*B.md/);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '重启长文');
      await selectNav(page, 'recent');
      await page.click('#clear-recent'); await ready(page);
      await page.waitForFunction(() => document.querySelectorAll('.recent-open').length === 0);
      assert.equal(await page.locator('.document-tab').count(), 1);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '重启长文');
      await close(); await launch();
      assert.deepEqual(await page.evaluate(() => window.desktop.recent()), []);
      assert.equal(await page.locator('.document-tab').count(), 1);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '重启长文');
      await close();
      const outside = path.join(temporary, 'outside'); await fs.mkdir(path.join(outside, '子目录'), { recursive: true });
      await fs.writeFile(path.join(outside, '子目录', '长文.md'), '# 未授权替换正文');
      await fs.rename(folder, path.join(temporary, 'old-root'));
      await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
      await launch();
      assert.equal(await page.locator('.document-tab').count(), 0);
      assert.equal(await page.locator('#workspaces section').count(), 0);
      assert.match(await page.locator('#session-status').innerText(), /工作区未恢复/);
      assert.equal(await page.locator('#markdown-content').innerText(), '');
    });

    await t.test('recent workspaces survive restart and only reopen the remembered canonical folder', async () => {
      const extra = path.join(temporary, '仅工作区');
      const moved = path.join(temporary, '已移动');
      const other = path.join(temporary, '替换目录');
      await fs.mkdir(extra);
      await fs.mkdir(other);
      await fs.writeFile(path.join(extra, '不打开的文件.md'), '# 文件树');
      await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, extra);
      await openWorkspace(page); await ready(page);
      await selectNav(page, 'recent');
      assert.equal(await page.locator('.recent-workspace-open').count(), 0);
      await selectNav(page, 'files');
      await page.locator('.workspace-close').click(); await ready(page);
      await close(); await launch();
      await selectNav(page, 'recent');
      const item = page.locator('.recent-workspace-open', { hasText: '仅工作区' });
      await item.waitFor();
      assert.equal(await page.locator('.recent-open').count(), 0);
      assert.equal(await page.evaluate(selected => window.desktop.openRecentWorkspace(selected).then(() => false, () => true), other), true);
      await fs.rename(extra, moved);
      await fs.symlink(other, extra, process.platform === 'win32' ? 'junction' : 'dir');
      await item.click(); await ready(page);
      assert.match(await page.locator('#operation-status').innerText(), /无法重新打开工作区/);
      assert.equal(await page.locator('#workspaces section').count(), 0);
      await fs.rm(extra);
      await fs.rename(moved, extra);
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw Error('Reopening must not prompt'); }; });
      await item.click(); await ready(page);
      await page.locator('.tree-file[data-name="不打开的文件.md"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.document-tab').count(), 0);
      await selectNav(page, 'recent');
      assert.equal(await page.locator('.recent-workspace-open').count(), 0);
      await selectNav(page, 'files');
      await page.locator('.workspace-close').click(); await ready(page);
      await selectNav(page, 'recent');
      await item.waitFor();
      await page.click('#clear-recent'); await ready(page);
      await item.waitFor({ state: 'detached' });
      await close(); await launch();
      assert.deepEqual(await page.evaluate(() => window.desktop.recentWorkspaces()), []);
    });
  } finally { if (app) await app.close(); }
});
