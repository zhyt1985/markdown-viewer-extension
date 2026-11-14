import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { exportFile, launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop treats API YAML and wiki syntax as local content and rejects excluded export operations', { timeout: 90000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-delivery-scope-'));
  const api = path.join(folder, 'scope.yaml');
  const md = path.join(folder, 'scope.md');
  await Promise.all([
    fs.writeFile(api, 'openapi: 3.0.3\ninfo:\n  title: Audit API\n  version: 1.0.0\npaths: {}\ncomponents:\n  schemas:\n    Ref:\n      $ref: ./unread.yaml\n'),
    fs.writeFile(md, '# Local scope\n\n[[private-note]] and ![[private-note]]\n\n[External](https://example.invalid/delivery-audit)\n'),
    fs.writeFile(path.join(folder, 'private-note.md'), '# Never expanded into the current preview\n'),
  ]);
  const packaged = process.env.MV_DESKTOP_EXECUTABLE;
  let app;
  try {
    app = await launchDesktop({ executablePath: packaged || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    async function pick(file) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await openFile(page);
      await page.waitForFunction(name => {
        const state = window.desktopApp.state();
        return !state.busy && state.document?.filename === name && state.preview.current;
      }, path.basename(file));
    }
    await pick(api);
    assert.match(await page.locator('#mv-source-view').innerText(), /openapi:\s*3\.0\.3/);
    assert.match(await page.locator('#mv-source-view').innerText(), /\$ref:\s*\.\/unread\.yaml/);
    assert.equal(await page.locator('#export-open').isDisabled(), true);

    await pick(md);
    const content = page.locator('#markdown-content');
    assert.match(await content.innerText(), /\[\[private-note\]\] and !\[\[private-note\]\]/);
    assert.doesNotMatch(await content.innerText(), /Never expanded into the current preview/);
    assert.deepEqual(await content.locator('a').allTextContents(), ['External']);
    await content.getByRole('link', { name: 'External' }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('相对 Markdown'));
    assert.equal(await page.locator('.document-tab').count(), 2);

    await page.click('#export-open');
    assert.deepEqual(await page.locator('[data-export-format]').evaluateAll(nodes =>
      nodes.map(node => node.dataset.exportFormat).sort()), ['docx', 'html', 'pdf', 'png']);
    assert.deepEqual(await page.evaluate(async () => {
      const { documentId, documentVersion } = window.desktopApp.state().document;
      return Promise.all(['epub', 'print', 'book', 'cli'].map(format =>
        window.desktop.exportDocument({ format, documentId, documentVersion }).then(() => 'allowed', error => error.message)));
    }).then(items => items.map(item => item.includes('Unsupported export format'))), [true, true, true, true]);

    for (const format of ['html', 'docx']) {
      const filePath = path.join(folder, `scope.${format}`);
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, filePath);
      await exportFile(page, format);
      await page.waitForFunction(() => window.desktopApp.state().task?.state === 'complete');
      const bytes = await fs.readFile(filePath);
      const contents = format === 'html' ? bytes.toString('utf8') :
        new TextDecoder().decode(unzipSync(bytes)['word/document.xml']);
      assert.match(contents, /\[\[private-note\]\] and !\[\[private-note\]\]/);
      assert.doesNotMatch(contents, /Never expanded into the current preview/);
    }
  } finally {
    if (app) await app.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
