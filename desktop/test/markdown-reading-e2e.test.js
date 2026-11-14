import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const layout = name => path.join(root, 'test', 'fixtures', 'layout', name);

test('the desktop reader preserves Markdown structure across real file opens', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results', 'desktop', executable ? 'packaged' : 'development', 'markdown-reading');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const footnotes = path.join(folder, '脚注 #%.md');
  const math = path.join(folder, '数学 UTF-16.md');
  const inlineHtml = path.join(folder, 'HTML 与 Emoji.md');

  const footnoteFixture = await fs.readFile(layout('footnotes.md'), 'utf8');
  const filler = Array.from({ length: 36 }, (_, i) => `阅读段落 ${i + 1}。\n\n`).join('');
  await fs.writeFile(footnotes, '\uFEFF' + footnoteFixture.replace('[^1]:', filler + '[^1]:').replace(/\r?\n/g, '\r\n'));
  await fs.writeFile(math, Buffer.from('\uFEFF' + await fs.readFile(layout('math.md'), 'utf8'), 'utf16le'));
  await fs.writeFile(inlineHtml, [
    '# 中文与 English',
    '',
    ':smile: :rocket: 与 `:smile:`',
    '',
    '面积 m<sup>2</sup>，水 H<sub>2</sub>O，<mark>重要</mark>。未知标签 <PLACEHOLDER>。',
    '',
    '<table style="border-collapse: collapse">',
    '  <thead><tr><th colspan="2" style="border: 1px solid; padding: 6px">指标 Summary</th></tr></thead>',
    '  <tbody>',
    '    <tr><td rowspan="2" style="border: 1px solid; padding: 6px">数值</td><td style="border: 1px solid; padding: 6px">Alpha</td></tr>',
    '    <tr><td style="border: 1px solid; padding: 6px">Beta</td></tr>',
    '  </tbody>',
    '</table>',
    '',
    '表格后的正文。',
    '',
    '| Name | 值 |',
    '| --- | --- |',
    '| 原生表格 | 2 |',
  ].join('\n'));

  const app = await launchDesktop({
    executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const ready = () => page.waitForFunction(() => !document.getElementById('open').disabled);
    const content = page.locator('#markdown-content');
    const reader = page.locator('#reader');
    async function open(source) {
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, source);
      await openFile(page);
      await ready();
      assert.match(await page.locator('#status').innerText(), /预览完成/);
      assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), []);
    }
    await ready();

    await t.test('footnote references in a UTF-8 BOM and CRLF document navigate and return within one tab', async () => {
      await open(footnotes);
      assert.equal(await content.locator('h1').innerText(), 'Footnote Fixture');
      const references = content.locator('.footnote-ref a');
      assert.deepEqual(await references.allTextContents(), ['[1]', '[2]']);
      assert.equal(await content.locator('.footnote-item').count(), 2);
      assert.equal(await content.locator('.footnote-item strong').innerText(), 'formatting');
      const start = await reader.evaluate(node => node.scrollTop);
      await references.nth(1).click();
      await ready();
      assert.equal(await page.locator('.document-tab').count(), 1);
      assert.ok(await reader.evaluate(node => node.scrollTop) > start + 400);
      const visible = await content.locator('.footnote-item').nth(1).evaluate(node => {
        const target = node.getBoundingClientRect(), viewport = node.closest('#reader').getBoundingClientRect();
        return target.top >= viewport.top - 2 && target.bottom <= viewport.bottom + 2;
      });
      assert.equal(visible, true);
      await page.click('#nav-back');
      await ready();
      assert.ok(Math.abs(await reader.evaluate(node => node.scrollTop) - start) <= 2);
      assert.equal(await content.locator('.md-footnotes-container').count(), 1);
    });

    await t.test('a GFM list preserves nested checked and unchecked items and clears the previous footnotes', async () => {
      await open(layout('task-list.md'));
      assert.equal(await content.locator('h1').innerText(), 'Task list alignment');
      const tasks = content.locator('li.task-list-item input[type="checkbox"]');
      assert.deepEqual(await tasks.evaluateAll(nodes => nodes.map(node => node.checked)), [false, true, false, true, false, false]);
      assert.equal(await content.locator('ul ul li.task-list-item').innerText().then(text => text.trim()), 'Nested task item');
      assert.equal(await content.locator('.md-footnotes-container').count(), 0);
    });

    await t.test('UTF-16 input retains both math modes and fenced code remains code', async () => {
      await open(math);
      assert.equal(await page.locator('.shell-encoding').innerText(), 'UTF-16LE');
      assert.equal(await content.locator('p .katex').count(), 1);
      assert.equal(await content.locator('.katex-display').count(), 1);
      await open(layout('code-block.md'));
      assert.equal(await content.locator('pre code.language-javascript .hljs-keyword').first().innerText(), 'const');
      assert.match(await content.locator('pre.shiki code').textContent(), /# Heading in a fence\s+- \[x\] task with \*\*strong\*\*/);
      assert.equal(await content.locator('h1').count(), 1);
    });

    await t.test('GitHub alerts retain kind, body formatting, and ordinary quotations', async () => {
      await open(path.join(root, 'demo', 'alert-demo.md'));
      for (const [kind, title] of Object.entries({ note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' })) {
        assert.equal(await content.locator(`blockquote.markdown-alert-${kind} > .markdown-alert-title`).first().innerText(), title);
      }
      assert.equal(await content.locator('.markdown-alert-tip strong').innerText(), 'bold');
      assert.match(await content.locator('blockquote:not(.markdown-alert)').allTextContents().then(text => text.join('\n')), /\[!NOTE\] this is not an alert/);
    });

    await t.test('inline HTML and Emoji render alongside native GFM and rasterized HTML tables', async () => {
      await open(inlineHtml);
      assert.equal(await content.locator('h1').innerText(), '中文与 English');
      assert.match(await content.innerText(), /😄 🚀/);
      assert.equal(await content.locator('code').innerText(), ':smile:');
      assert.equal(await content.locator('sup').innerText(), '2');
      assert.equal(await content.locator('sub').innerText(), '2');
      assert.equal(await content.locator('mark').count(), 0);
      assert.match(await content.innerText(), /重要。未知标签 <PLACEHOLDER>。/);
      const image = content.locator('.diagram-block[data-plugin-type="html"] img');
      assert.equal(await image.count(), 1);
      assert.equal(await image.evaluate(node => node.complete && node.naturalWidth > 0
        && node.naturalHeight > 0 && node.currentSrc.startsWith('data:image/png')), true);
      assert.match(await content.innerText(), /表格后的正文。/);
      assert.deepEqual(await content.locator('.desktop-table-scroll table td').allTextContents(), ['原生表格', '2']);
      await page.screenshot({ path: path.join(artifacts, 'html-emoji.png'), scale: 'css' });
    });
  } finally {
    await app.close();
  }
});
