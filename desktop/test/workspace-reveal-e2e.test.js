import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentMenu, launchDesktop, openFile, openWorkspace, selectNav } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop reveals the current file across nested and paged workspaces without reopening it', { timeout: 90000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-workspace-reveal-'));
  const outer = path.join(folder, '父工作区'), inner = path.join(outer, 'Section-500');
  const leaf = path.join(inner, '子目录');
  const target = path.join(leaf, 'Doc-500 中文.md'), outside = path.join(folder, 'outside.md');
  const markdown = '# 原文\n\n源文件保持原样。\n';
  const draft = '# 草稿仍在\n\n定位只调整文件树。';
  await fs.mkdir(leaf, { recursive: true });
  for (let start = 0; start < 500; start += 50) {
    await Promise.all(Array.from({ length: 50 }, (_, offset) => {
      const i = String(start + offset).padStart(3, '0');
      return Promise.all([fs.mkdir(path.join(outer, `Section-${i}`)), fs.writeFile(path.join(leaf, `Doc-${i}.md`), '# Fixture')]);
    }));
  }
  await Promise.all([fs.writeFile(target, markdown), fs.writeFile(outside, '# Outside')]);
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  let app;
  try {
    app = await launchDesktop({ executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    async function pick(file, action = openFile) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await action(page);
      await page.waitForFunction(() => !window.desktopApp.state().busy);
    }
    const reveal = () => documentMenu(page, '#workspace-reveal');
    const marked = page.locator('#workspaces .tree-file[aria-current="true"]');
    await pick(outer, openWorkspace);
    assert.equal(await page.locator('.tree-dir[data-name="Section-500"]').count(), 0);
    await pick(target); // Opening via the file picker does not associate the tab with the workspace.
    const id = await page.evaluate(() => window.desktopApp.state().document.documentId);
    await page.locator('[data-shell-mode="split"]').click();
    await page.locator('#markdown-editor').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(draft);
    await page.evaluate(() => window.desktopEditor.flush());
    await selectNav(page, 'recent');
    await reveal();
    await marked.waitFor();
    assert.equal(await marked.textContent(), path.basename(target));
    assert.equal(await marked.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('.tree-dir[data-name="Section-500"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.tree-dir[data-name="子目录"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.tree-file[data-name="Doc-000.md"]').count(), 0);
    assert.equal(await page.evaluate(() => window.desktopApp.state().document.documentId), id);
    assert.equal(await page.evaluate(() => window.desktopCodeEditor.getText()), draft);
    assert.equal(await fs.readFile(target, 'utf8'), markdown);

    await pick(inner, openWorkspace);
    await reveal();
    await page.waitForFunction(() => document.querySelector('.tree-file[aria-current="true"]')
      ?.closest('section').querySelector('.workspace-header strong').textContent === 'Section-500');
    assert.equal(await marked.count(), 1);

    await pick(outside);
    assert.equal(await marked.count(), 0);
    await reveal();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('不在已打开的工作区'));
    assert.equal(await marked.count(), 0);
    await assert.rejects(page.evaluate(id => window.desktop.revealWorkspaceFile(id), id), /本机文档|locat/i);
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
