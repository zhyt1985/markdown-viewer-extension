import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { launchDesktop, openFile } from './ui-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('PDF options paginate the actual export and save exactly what the preview showed', { timeout: 90000 }, async () => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'pdf-layout');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const source = path.join(folder, 'Pagination.md');
  const fixture = '# PDF LAYOUT SAMPLE\n\n' + Array.from({ length: 20 }, (_, i) =>
    `## Section ${i + 1}\n\nA sample paragraph that stays readable across paper sizes and margins.\n\n`).join('')
    + '| KEY | VALUE |\n|---|---|\n' + Array.from({ length: 65 }, (_, i) =>
      `| Row ${String(i + 1).padStart(2, '0')} | Printable text |\n`).join('')
    + '\n```mermaid\ngraph LR\n A[Start] --> B[Finish]\n```\n\nEND OF DOCUMENT\n';
  await fs.writeFile(source, fixture);
  const packaged = process.env.MV_DESKTOP_EXECUTABLE;
  const app = await launchDesktop({ executablePath: packaged || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, '--lang=zh-CN', ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const ready = () => page.waitForFunction(() => window.desktopApp?.state().preview.current && !window.desktopApp.state().busy);
    await page.waitForFunction(() => window.desktopApp && !document.getElementById('open').disabled);
    await app.evaluate(({ app, dialog }, source) => {
      const hash = process.getBuiltinModule('node:crypto').createHash;
      globalThis.__pdfPrints = [];
      app.on('web-contents-created', (_event, contents) => {
        const print = contents.printToPDF.bind(contents);
        contents.printToPDF = async (...args) => {
          const bytes = await print(...args);
          if (globalThis.__pdfGate) await globalThis.__pdfGate();
          globalThis.__pdfPrints.push(hash('sha256').update(bytes).digest('hex'));
          return bytes;
        };
      });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      dialog.showSaveDialog = async () => { throw Error('Preview must not ask for a save destination'); };
    }, source);
    await openFile(page);
    await ready();
    await page.locator('#reader').evaluate(reader => { reader.scrollTop = 540; });
    const top = await page.locator('#reader').evaluate(reader => reader.scrollTop);
    const openPdf = async () => { await page.click('#export-open'); await page.click('#pdf'); };
    const save = async filename => {
      const target = path.join(folder, filename);
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
      await page.click('#export-start');
      await page.waitForFunction(() => window.desktopApp.state().task?.state === 'complete');
      return fs.readFile(target);
    };
    const inspect = async bytes => {
      const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true,
        standardFontDataUrl: `${path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/` });
      const pdf = await loading.promise;
      try {
        const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
          const page = await pdf.getPage(i + 1);
          return { view: page.view, text: (await page.getTextContent()).items.filter(item => 'str' in item) };
        }));
        return { pages, text: pages.flatMap(page => page.text.map(item => item.str)).join(' ') };
      } finally { await loading.destroy(); }
    };
    await openPdf();
    await page.selectOption('#pdf-paper', 'A5');
    await page.selectOption('#pdf-orientation', 'landscape');
    await page.fill('#pdf-margin', '36');
    assert.equal(await page.locator('#export-start').isDisabled(), true);
    await page.fill('#pdf-margin', '22');
    const sourceId = await page.evaluate(() => window.desktopApp.state().document);
    assert.equal(await page.evaluate(selected => window.desktop.exportDocument({ format: 'pdf',
      documentId: selected.documentId, documentVersion: selected.documentVersion,
      pdfOptions: { paper: 'arbitrary', orientation: 'landscape', margin: 22 },
    }).then(() => false, () => true), sourceId), true);
    await page.click('#pdf-preview-start');
    const status = page.locator('#pdf-preview-status');
    await page.waitForFunction(() => /第 1 \/ \d+ 页|预览失败/.test(document.getElementById('pdf-preview-status').textContent));
    const first = (await status.textContent()).match(/第 1 \/ (\d+) 页/);
    assert.ok(first, await status.textContent());
    assert.ok(Number(first[1]) > 2);
    assert.equal(await page.locator('#pdf-preview-canvas').evaluate(canvas => canvas.width > canvas.height), true);
    await page.click('#pdf-preview-next');
    await page.waitForFunction(() => document.getElementById('pdf-preview-status').textContent.startsWith('第 2 /'));
    await page.screenshot({ path: path.join(folder, 'preview.png') });
    const a5 = await save('a5-landscape.pdf');
    assert.deepEqual(await app.evaluate(() => globalThis.__pdfPrints), [sha256(a5)], 'preview and saved PDF must be the same bytes');
    const previewed = await inspect(a5);
    assert.equal(previewed.pages.length, Number(first[1]));
    const [,, width, height] = previewed.pages[0].view;
    assert.ok(Math.abs(width - 210 * 72 / 25.4) < 2 && Math.abs(height - 148 * 72 / 25.4) < 2, `${width} × ${height}`);
    for (const term of ['PDF LAYOUT SAMPLE', 'Row 01', 'Row 65', 'END OF DOCUMENT']) assert.ok(previewed.text.includes(term), term);

    await openPdf();
    await page.fill('#pdf-margin', '8');
    const narrow = await inspect(await save('a5-narrow-margin.pdf'));
    const startX = result => result.pages[0].text.find(item => item.str.startsWith('Section 1')).transform[4];
    assert.ok(startX(previewed) - startX(narrow) > 35, 'larger margins must move text inward');
    assert.ok(previewed.pages.length > narrow.pages.length, 'larger margins must change pagination');
    await openPdf();
    await page.selectOption('#pdf-paper', 'Letter');
    await page.selectOption('#pdf-orientation', 'portrait');
    const letter = await inspect(await save('letter-portrait.pdf'));
    assert.ok(Math.abs(letter.pages[0].view[2] - 612) < 2 && Math.abs(letter.pages[0].view[3] - 792) < 2);

    // A changed option cancels an in-flight preview and must not show its pages.
    await app.evaluate(() => {
      globalThis.__pdfGate = () => new Promise(resolve => { globalThis.__releasePdf = resolve; });
    });
    await openPdf();
    await page.click('#pdf-preview-start');
    for (let i = 0; i < 100 && !await app.evaluate(() => Boolean(globalThis.__releasePdf)); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await app.evaluate(() => Boolean(globalThis.__releasePdf)), true);
    await page.fill('#pdf-margin', '10');
    await page.waitForFunction(() => !document.getElementById('pdf-preview-start').disabled);
    await app.evaluate(() => { delete globalThis.__pdfGate; globalThis.__releasePdf(); });
    assert.equal(await page.locator('#pdf-preview-surface').isHidden(), true);
    await page.click('#pdf-preview-start');
    await page.waitForFunction(() => document.getElementById('pdf-preview-status').textContent.startsWith('第 1 /'));
    await page.keyboard.press('Escape');
    assert.ok(Math.abs(await page.locator('#reader').evaluate(reader => reader.scrollTop) - top) < 3);
    assert.equal(await fs.readFile(source, 'utf8'), fixture);
  } finally { await app.close(); }
});
