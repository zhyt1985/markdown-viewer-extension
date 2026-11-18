import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { exportFile, launchDesktop, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('local HTML and clipboard HTML become portable Markdown drafts', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'html-import');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, 'workspace');
  const assets = path.join(workspace, 'assets');
  const name = '来源 #%.html';
  const html = path.join(workspace, 'pages', name);
  const image = await fs.readFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'));
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
  const source = `<!doctype html><html><head><title>转换标题</title></head><body>
<nav>侧栏噪声</nav><main><h1>转换标题</h1><p>有 <strong>格式</strong> 的正文。</p>
<table><tr><th>列一</th><th>列二</th></tr><tr><td>甲</td><td>乙</td></tr></table>
<p><img alt="本地图" src="../assets/图%20%23.png"></p>
<p><img alt="外部图" src="https://example.invalid/remote.png"></p>
<p><img alt="越界图" src="../assets/outside/outside.png"></p>
<script>document.querySelector('h1').textContent = '脚本修改';</script>
</main></body></html>`;
  await Promise.all([fs.mkdir(assets, { recursive: true }), fs.mkdir(path.dirname(html), { recursive: true })]);
  await Promise.all([
    fs.writeFile(html, source), fs.writeFile(path.join(assets, '图 #.png'), image),
    fs.writeFile(path.join(folder, 'outside.png'), image),
    fs.symlink(folder, path.join(assets, 'outside'), process.platform === 'win32' ? 'junction' : 'dir'),
  ]);

  let app, page;
  const status = () => page.locator('#status').innerText();
  const current = () => page.evaluate(() => window.desktopApp.state().document);
  const markdown = () => page.evaluate(() => window.desktopCodeEditor.getText());
  const ready = filename => page.waitForFunction(filename => {
    const state = window.desktopApp?.state();
    return state && !state.busy && state.preview.current && state.document?.filename === filename;
  }, filename);
  const saveTo = filePath => app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filePath);
  const imageWidth = () => page.locator('#markdown-content img').evaluate(img => img.naturalWidth);
  const fileAction = async selector => {
    await page.click('[data-shell-action="file-menu"]');
    await page.click(selector);
  };
  async function launch() {
    app = await launchDesktop({ executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.desktopApp) && !document.getElementById('open').disabled);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  }

  let imported, importedId;
  try {
    await launch();
    await t.test('file conversion uses the source and its workspace path, and reports omitted images', async () => {
      await app.evaluate(({ dialog }, workspace) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
      }, workspace);
      await openWorkspace(page);
      await page.locator('.tree-dir[data-name="pages"]').click();
      await page.locator('.tree-file', { hasText: name }).click();
      await ready(name);
      await fileAction('#convert-html');
      await ready('未命名 1.md');
      imported = await markdown();
      importedId = (await current()).documentId;
      assert.equal((await current()).untitled, true);
      assert.equal(await page.locator('#editor-pane').isVisible(), true);
      assert.match(imported, /^# 转换标题\n/);
      assert.match(imported, /\*\*格式\*\*/);
      assert.match(imported, /\| 列一 \| 列二 \|/);
      assert.ok(imported.includes(`![本地图](${dataUrl})`));
      assert.match(imported, /图片未导入：外部图/);
      assert.match(imported, /图片未导入：越界图/);
      assert.doesNotMatch(imported, /侧栏噪声|脚本修改|example\.invalid|outside\.png/);
      assert.match(await status(), /2 张图片未导入/);
      assert.equal(await imageWidth(), 48);
      assert.equal(await fs.readFile(html, 'utf8'), source);
    });

    await t.test('imported content recovers after restart, saves elsewhere, and exports to Word and PDF', async () => {
      await app.close();
      app = null;
      await launch();
      await ready('未命名 1.md');
      assert.equal((await current()).documentId, importedId);
      assert.equal(await markdown(), imported);
      assert.equal(await imageWidth(), 48);
      for (const format of ['docx', 'pdf']) {
        const output = path.join(folder, `imported.${format}`);
        await saveTo(output);
        await exportFile(page, format);
        await page.waitForFunction(() => !window.desktopApp.state().exporting);
        const bytes = await fs.readFile(output);
        if (format === 'docx') assert.ok(Object.keys(unzipSync(bytes)).some(name => name.startsWith('word/media/')));
        else assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      }
      const output = path.join(folder, '另存结果.md');
      await saveTo(output);
      await page.click('#save');
      await ready(path.basename(output));
      assert.equal(await fs.readFile(output, 'utf8'), imported);
      assert.equal(await imageWidth(), 48);
    });

    await t.test('clipboard conversion keeps embedded images and rejects a plain-text clipboard', async () => {
      const clipboard = (html, text) => app.evaluate(({ clipboard, ClipboardItem }, { html, text }) => {
        clipboard.read = async () => [new ClipboardItem(html ? { 'text/html': html, 'text/plain': text } : { 'text/plain': text })];
        clipboard.readText = async () => text;
      }, { html, text });
      const paste = () => fileAction('#paste-html');
      await clipboard('', '普通文本');
      const before = (await current()).documentId;
      await paste();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('剪贴板中没有可转换的 HTML'));
      assert.equal((await current()).documentId, before);
      const paragraph = '这段独立正文需要在导入时保留。'.repeat(20);
      await clipboard(`<title>粘贴标题</title><article><p>${paragraph}</p><p><img alt="内嵌图" src="${dataUrl}"></p>
<p><img alt="相对图" src="../assets/图%20%23.png"></p></article>`, '普通文本');
      await paste();
      await ready('未命名 1.md');
      const result = await markdown();
      assert.match(result, /^# 粘贴标题\n/);
      assert.ok(result.includes(paragraph));
      assert.ok(result.includes(`![内嵌图](${dataUrl})`));
      assert.match(result, /图片未导入：相对图/);
      assert.match(await status(), /1 张图片未导入/);
      assert.equal(await imageWidth(), 48);
    });
  } finally { await app?.close(); }
});
