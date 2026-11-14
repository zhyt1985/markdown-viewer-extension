import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { launchDesktop, openFile, closeDialogs } from './ui-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop annotations preserve exact selections, portable files and document ownership', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'annotations');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const first = path.join(folder, '批注甲.md'), second = path.join(folder, '批注乙.md');
  const portable = path.join(folder, '批注.remarks.json');
  const legacy = path.join(folder, '兼容.remarks.json');
  const source = '# 批注验证\n\n重复文字，前半段。重复文字，后半段。\n\n第二段内容。\n';
  await Promise.all([fs.writeFile(first, source), fs.writeFile(second, source.replaceAll('\n', '\r\n'))]);
  let app, page;
  const pageErrors = [];
  const launch = async () => {
    const executable = process.env.MV_DESKTOP_EXECUTABLE;
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
    await page.waitForFunction(() => Boolean(window.desktopShell) && !document.getElementById('open').disabled);
  };
  const pick = async (file, type) => {
    await app.evaluate(({ dialog }, { file, type }) => {
      if (type === 'save') dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      else dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, { file, type });
  };
  const waitAnnotations = async count => {
    await page.waitForFunction(count => !document.getElementById('annotation-import').disabled
      && document.querySelectorAll('#annotation-list li').length === count, count);
  };
  const tab = name => page.locator('.tab-open', { hasText: name });
  const mark = () => page.locator('#markdown-content mark[data-desktop-remark]');
  const select = async (occurrence = 0, across = false) => {
    await page.evaluate(({ occurrence, across }) => {
      const content = document.getElementById('markdown-content');
      const [paragraph, next] = content.querySelectorAll('p');
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const phrase = '重复文字';
      const text = nodes.map(node => node.data).join('');
      const start = occurrence === 0 ? text.indexOf(phrase) : text.lastIndexOf(phrase);
      function point(offset) {
        for (const node of nodes) {
          if (offset <= node.length) return [node, offset];
          offset -= node.length;
        }
        throw Error('selection fixture offset missing');
      }
      const range = document.createRange();
      range.setStart(...point(start));
      if (across) range.setEnd(next.firstChild, 3);
      else range.setEnd(...point(start + phrase.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      content.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, { occurrence, across });
    await page.locator('#annotation-toolbar').waitFor({ state: 'visible' });
  };
  const add = async (color, note, count) => {
    await page.click(`#annotation-toolbar [data-annotation-color="${color}"]`);
    await page.fill('#annotation-note', note);
    await page.click('#annotation-add');
    await waitAnnotations(count);
  };

  try {
    await launch();
    await pick(first, 'open');
    await openFile(page);
    await waitAnnotations(0);

    await t.test('different occurrences of the same quote and a multi-block selection are annotated independently', async () => {
      await select(1);
      await add('green', '后半段批注', 1);
      await select(0);
      await add('blue', '前半段批注', 2);
      await select(1, true);
      await add('pink', '跨段批注', 3);
      const entries = await page.evaluate(() => window.desktop.annotations('get', window.desktopApp.state().document));
      const [later, earlier, spanning] = entries.annotations;
      assert.ok(later.anchor.parts[0].offset > earlier.anchor.parts[0].offset);
      assert.equal(later.selectedText, earlier.selectedText);
      assert.equal(spanning.anchor.parts.length, 2);
      assert.equal(await page.locator('#annotation-list li').count(), 3);
      assert.equal(await mark().filter({ hasText: '重复文字' }).count() >= 2, true);
      assert.equal(await fs.readFile(first, 'utf8'), source);
      await page.screenshot({ path: path.join(artifacts, 'annotation-sidebar.png'), scale: 'css' });
    });

    await t.test('notes, display preferences, deletion and undo update both the sidebar and the document', async () => {
      const entry = page.locator('#annotation-list li').filter({ hasText: '前半段批注' });
      await entry.getByRole('button', { name: '编辑备注' }).click();
      await page.fill('#annotation-note-edit', '修改后的备注');
      await page.click('#annotation-note-save');
      await page.locator('#annotation-list').getByText('修改后的备注').waitFor();
      assert.equal(await mark().filter({ hasText: '重复文字' }).evaluateAll(nodes => nodes.some(node => node.title === '修改后的备注')), true);
      await page.locator('#annotation-display summary').click();
      for (const style of ['underline', 'wavy', 'border', 'background']) {
        await page.selectOption('#annotation-style', style);
        await page.waitForFunction(() => !document.getElementById('annotation-style').disabled);
        const css = await mark().first().evaluate(node => {
          const style = getComputedStyle(node);
          return [style.textDecorationLine, style.textDecorationStyle, style.borderTopStyle, style.backgroundColor];
        });
        if (style === 'underline') assert.equal(css[0], 'underline');
        if (style === 'wavy') assert.equal(css[1], 'wavy');
        if (style === 'border') assert.equal(css[2], 'solid');
        if (style === 'background') assert.notEqual(css[3], 'rgba(0, 0, 0, 0)');
      }
      await page.uncheck('#annotation-visible');
      await mark().first().waitFor({ state: 'detached' });
      await page.check('#annotation-visible');
      await mark().first().waitFor();
      await page.locator('#annotation-list li').filter({ hasText: '修改后的备注' }).getByRole('button', { name: '删除', exact: true }).click();
      await waitAnnotations(2);
      await page.click('#annotation-undo');
      await waitAnnotations(3);
    });

    await t.test('portable import previews new, duplicate and unresolved annotations before merge', async () => {
      await pick(portable, 'save');
      await page.click('#annotation-export');
      await page.waitForFunction(() => document.getElementById('annotation-status').textContent === '已导出批注文件。');
      const exported = JSON.parse(await fs.readFile(portable, 'utf8'));
      assert.equal(exported.type, 'markdown-viewer-remarks');
      assert.equal(exported.version, 1);
      assert.equal(exported.annotations.length, 3);
      assert.equal(exported.annotations[0].startLine, 2);
      assert.equal(Object.keys(exported.desktopAnchors).length, 3);
      await pick(second, 'open');
      await openFile(page);
      await waitAnnotations(0);
      assert.equal(await mark().count(), 0);
      await pick(portable, 'open');
      await page.click('#annotation-import');
      await page.locator('#annotation-import-dialog').waitFor();
      assert.match(await page.locator('#annotation-import-preview').innerText(), /新增 3 条，重复 0 条，待重新定位 0 条/);
      assert.equal(await page.locator('#annotation-list li').count(), 0);
      await page.click('#annotation-import-confirm');
      await waitAnnotations(3);
      await page.click('#annotation-import');
      await page.locator('#annotation-import-dialog').waitFor();
      assert.match(await page.locator('#annotation-import-preview').innerText(), /新增 0 条，重复 3 条/);
      assert.equal(await page.locator('#annotation-import-confirm').isDisabled(), true);
      await closeDialogs(page);
      await fs.writeFile(legacy, JSON.stringify([{ id: 'legacy', startLine: 0, endLine: 0, selectedText: '批注验证', color: 'yellow', note: '旧版批注', timestamp: 1 }]));
      await pick(legacy, 'open');
      await page.click('#annotation-import');
      await page.locator('#annotation-import-dialog').waitFor();
      assert.match(await page.locator('#annotation-import-preview').innerText(), /新增 1 条，重复 0 条，待重新定位 1 条/);
      await page.click('#annotation-import-confirm');
      await waitAnnotations(4);
      await tab('批注甲.md').click();
      await waitAnnotations(3);
      assert.equal(await page.locator('#annotation-list li').filter({ hasText: '旧版批注' }).count(), 0);
    });

    await t.test('changed source keeps notes pending until the reader explicitly relocates them', async () => {
      const updated = source.replace('# 批注验证', '# 新版批注验证');
      await fs.writeFile(first, updated);
      await tab('批注甲.md').click();
      await page.waitForFunction(() => document.querySelector('#markdown-content h1')?.textContent === '新版批注验证');
      await waitAnnotations(3);
      assert.equal(await mark().count(), 0);
      assert.equal(await page.locator('#annotation-list small').filter({ hasText: '待重新定位' }).count(), 3);
      await select(1);
      await page.locator('#annotation-list li').filter({ hasText: '后半段批注' }).getByRole('button', { name: '关联当前选区' }).click();
      await waitAnnotations(3);
      assert.equal(await mark().count(), 1);
      assert.equal(await page.locator('#annotation-list small').filter({ hasText: '待重新定位' }).count(), 2);
      assert.equal(await fs.readFile(first, 'utf8'), updated);
    });

    await t.test('restart restores annotations and clipboard close uses the normal dirty-document confirmation', async () => {
      await app.close();
      await launch();
      await waitAnnotations(3);
      await page.click('#annotations-open');
      assert.equal(await mark().count(), 1);
      await page.locator('#annotation-display summary').click();
      await page.check('#annotation-close-after-copy');
      await page.waitForFunction(() => !document.getElementById('annotation-close-after-copy').disabled);
      await app.evaluate(({ clipboard, dialog }) => {
        clipboard.writeText = text => { globalThis.annotationClipboard = text; };
        dialog.showMessageBox = async () => { globalThis.annotationClosePrompted = true; return { response: 0 }; };
      });
      await page.click('[data-shell-mode="split"]');
      await page.fill('#markdown-editor', '# 未保存的批注文档\n\n正文。');
      await page.waitForFunction(() => window.desktopApp.state().preview.current);
      await page.click('#annotations-open');
      await waitAnnotations(3);
      await page.click('#annotation-copy');
      await page.waitForFunction(() => !document.getElementById('annotation-copy').disabled);
      const result = await app.evaluate(() => ({ text: globalThis.annotationClipboard, prompted: globalThis.annotationClosePrompted }));
      assert.match(result.text, /后半段批注/);
      assert.equal(result.prompted, true);
      assert.equal(await page.evaluate(() => window.desktopApp.state().dirty), true);
      assert.equal(await tab('批注甲.md').count(), 1);
      assert.deepEqual(pageErrors, []);
    });

    await t.test('first save moves an untitled document’s annotations to the saved file identity', async () => {
      await page.click('[data-shell-action="file-menu"]');
      await page.click('#new-document');
      await page.locator('#markdown-editor').waitFor();
      await page.fill('#markdown-editor', source);
      await page.waitForFunction(() => window.desktopApp.state().preview.current);
      await waitAnnotations(0);
      const originalId = await page.evaluate(() => window.desktopApp.state().document.documentId);
      await select();
      await add('yellow', '草稿批注随文件保存', 1);
      const destination = path.join(folder, '草稿保存.md');
      await pick(destination, 'save');
      await page.click('[data-shell-action="file-menu"]');
      await page.click('[data-shell-menu="file"] [data-shell-action="save"]');
      await page.waitForFunction(() => window.desktopApp.state().document?.filename === '草稿保存.md');
      await waitAnnotations(1);
      const id = await page.evaluate(() => window.desktopApp.state().document.documentId);
      assert.notEqual(id, originalId);
      assert.equal(await mark().count(), 1);
      assert.equal(await fs.readFile(destination, 'utf8'), source);
      const dataDirectory = path.join(folder, 'profile', 'annotations');
      assert.equal((await fs.readdir(dataDirectory)).includes(`${originalId}.json`), false);
      assert.equal(JSON.parse(await fs.readFile(path.join(dataDirectory, `${id}.json`), 'utf8')).annotations[0].note, '草稿批注随文件保存');
    });
  } finally {
    if (app) {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); }).catch(() => {});
      await app.close();
    }
  }
});
