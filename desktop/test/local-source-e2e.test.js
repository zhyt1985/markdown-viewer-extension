import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentMenu, launchDesktop, openFile, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('local text, YAML and code open as read-only tabs without disrupting Markdown editing', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results', 'desktop', executable ? 'packaged' : 'development', 'local-source');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, '工作区');
  await fs.mkdir(workspace);
  const notes = path.join(workspace, '说明 #%.TXT');
  const config = path.join(workspace, '配置.YAML');
  const script = path.join(workspace, 'sample.js');
  const markdown = path.join(workspace, '草稿.md');
  const large = path.join(workspace, 'large.log');
  const notesText = '# 中文原文\n<script>window.sourceWasExecuted = true;</script>';
  const scriptText = 'const greeting = "Hello";\nwindow.sourceWasExecuted = true;';
  await Promise.all([
    fs.writeFile(notes, Buffer.from('\uFEFF' + notesText.replaceAll('\n', '\r\n'), 'utf16le')),
    fs.copyFile(path.join(root, 'test/fixtures/vscode/config.yaml'), config),
    fs.writeFile(script, scriptText),
    fs.writeFile(markdown, '# 原始 Markdown\n'),
    fs.writeFile(path.join(workspace, 'not-supported.bin'), 'Unsupported format'),
    fs.writeFile(large, 'a\n'.repeat(10000) + 'last line'),
  ]);

  let app, page;
  async function launch(files = []) {
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')]), ...files],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  }
  const ready = filename => page.waitForFunction(name => {
    const state = window.desktopApp?.state();
    return state?.preview.current && !state.busy && state.document?.filename === name;
  }, filename, { timeout: 20000 });
  const source = () => page.locator('#mv-source-view');
  async function pick(file, open = openFile) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await open(page);
  }
  try {
    await launch([notes]);
    await ready(path.basename(notes));

    await t.test('launching with a UTF-16 text file shows numbered literal text without a document resource grant', async () => {
      assert.deepEqual(await source().locator('.mv-source-line-content').allTextContents(), notesText.split('\n'));
      assert.deepEqual(await source().locator('.mv-source-line').evaluateAll(lines => lines.map(line => line.dataset.lineNumber)), ['1', '2']);
      assert.equal(await page.locator('.shell-encoding').innerText(), 'UTF-16LE');
      assert.equal(await page.locator('#save-indicator').textContent(), '只读');
      assert.equal(await page.locator('#markdown-content h1, #mv-source-view script').count(), 0);
      assert.equal(await page.evaluate(() => window.sourceWasExecuted), undefined);
      const readOnly = await page.evaluate(async () => {
        const doc = window.desktopApp.state().document;
        const refused = promise => promise.then(() => false, () => true);
        return [
          await refused(window.desktop.updateDraft({ documentId: doc.documentId, revision: doc.revision, markdown: 'should not persist' })),
          await refused(window.desktop.save({ documentId: doc.documentId, revision: doc.revision, saveAs: false })),
          await refused(window.desktop.exportDocument({ documentId: doc.documentId, documentVersion: doc.documentVersion, format: 'pdf' })),
          (await fetch(`${doc.documentBaseUrl}/${encodeURIComponent(doc.filename)}`)).status === 403,
        ];
      });
      assert.deepEqual(readOnly, [true, true, true, true]);
    });

    await t.test('workspace opens YAML with highlighting and leaves unsupported formats disabled', async () => {
      await pick(workspace, openWorkspace);
      await page.locator('.tree-file[data-name="配置.YAML"]').click();
      await ready('配置.YAML');
      assert.equal(await source().locator('.mv-source').getAttribute('data-language'), 'yaml');
      assert.ok(await source().locator('.hljs-attr').count() > 0);
      assert.match((await source().locator('.mv-source-line-content').allTextContents()).join('\n'), /host: 127\.0\.0\.1/);
      assert.equal(await page.locator('.tree-file[data-name="not-supported.bin"]').isDisabled(), true);
      await page.screenshot({ path: path.join(artifacts, 'yaml.png'), scale: 'css' });
    });

    await t.test('opening code from the picker keeps the Markdown draft, undo history and split mode on return', async () => {
      await pick(markdown);
      await ready('草稿.md');
      await page.locator('[data-shell-mode="split"]').click();
      await page.locator('#markdown-editor').fill('# 未保存的修改');
      await page.evaluate(() => window.desktopEditor.flush());
      await pick(script);
      await ready('sample.js');
      assert.equal(await source().locator('.hljs-keyword').first().textContent(), 'const');
      assert.equal(await page.evaluate(() => window.sourceWasExecuted), undefined);
      for (const selector of ['#edit-toggle', '#export-open', '#annotations-open', '#save', '#save-as']) {
        assert.equal(await page.locator(selector).isDisabled(), true, selector);
      }
      assert.equal(await page.locator('#editor-pane').isHidden(), true);
      await page.locator('.tab-open', { hasText: '草稿.md' }).click();
      await ready('草稿.md');
      assert.equal(await source().isHidden(), true);
      assert.equal(await source().locator('code').count(), 0);
      assert.equal(await page.locator('#editor-pane').isVisible(), true);
      assert.equal(await page.evaluate(() => window.desktopCodeEditor.value), '# 未保存的修改');
      assert.equal(await page.evaluate(() => window.desktopCodeEditor.canUndo), true);
      assert.equal(await fs.readFile(markdown, 'utf8'), '# 原始 Markdown\n');
    });

    await t.test('large source uses a plain view and reloaded code restores across restart', async () => {
      await pick(large);
      await ready('large.log');
      assert.equal(await source().locator('.mv-source-line').count(), 0);
      assert.equal(await source().locator('code').textContent(), 'a\n'.repeat(10000) + 'last line');
      await page.locator('.tab-open', { hasText: 'sample.js' }).click();
      await ready('sample.js');
      await page.uncheck('#auto-refresh');
      await fs.writeFile(script, 'const reloaded = "从磁盘更新";');
      await documentMenu(page, '#reload-file');
      await ready('sample.js');
      assert.match(await source().innerText(), /从磁盘更新/);
      await app.close();
      app = null;
      await launch();
      await ready('sample.js');
      assert.equal(await page.locator('.document-tab').count(), 5);
      assert.match(await source().innerText(), /从磁盘更新/);
      assert.equal(await page.locator('#export-open').isDisabled(), true);
    });
  } finally {
    await app?.close();
  }
});
