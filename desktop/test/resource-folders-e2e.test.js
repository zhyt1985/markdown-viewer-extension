import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { closeDialogs, documentMenu, exportFile, launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('extra local resource folders are scoped to an open tab and can be revoked', { timeout: 150000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'resource-folders');
  await fs.mkdir(artifacts, { recursive: true });
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(artifacts, 'run-')));
  const docs = path.join(temporary, 'docs');
  const assets = path.join(temporary, '资源 #');
  const outside = path.join(temporary, 'outside');
  const folderName = encodeURIComponent(path.basename(assets));
  const imageName = '图 #%.png';
  const imageRef = `../${folderName}/${encodeURIComponent(imageName)}`;
  const markdown = path.join(docs, 'main.md');
  const peer = path.join(docs, 'peer.md');
  const chart = path.join(docs, 'chart.vl');
  const html = path.join(docs, 'page.html');
  const slides = path.join(docs, 'demo.slides.md');
  const source = `# Scope\n\n![Shared image](${imageRef})\n`;
  const icon = path.join(root, 'test/fixtures/layout/assets/icon48.png');
  await Promise.all([docs, assets, outside].map(folder => fs.mkdir(folder)));
  await Promise.all([
    fs.writeFile(markdown, source), fs.writeFile(peer, source),
    fs.writeFile(html, `<!doctype html><link rel="stylesheet" href="/primary.css"><main><h1>Shared image</h1><img src="${imageRef}" alt="Shared image"></main>`),
    fs.writeFile(path.join(docs, 'primary.css'), `@font-face{font-family:Extra;src:url('../${folderName}/extra.woff2')}h1{font-family:Extra,serif;color:rgb(20,30,40)}`),
    fs.writeFile(slides, `# Shared slide\n\n![Shared image](${imageRef})`),
    fs.writeFile(chart, JSON.stringify({ data: { url: `../${folderName}/table.csv` }, mark: 'bar', encoding: { x: { field: 'name', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } } })),
    fs.writeFile(path.join(assets, 'table.csv'), 'name,value\nA,3\nB,7\n'),
    fs.writeFile(path.join(assets, 'other.md'), '# Extra directory is not a workspace'),
    fs.writeFile(path.join(assets, 'script.js'), 'window.extraScript = true;'),
    fs.copyFile(icon, path.join(assets, imageName)), fs.copyFile(icon, path.join(outside, 'hidden.png')),
    fs.copyFile(path.join(root, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'), path.join(assets, 'extra.woff2')),
    fs.symlink(outside, path.join(assets, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'),
  ]);
  let app, page;
  async function launch() {
    app = await launchDesktop({ executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(temporary, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    await ready();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  }
  const state = () => page.evaluate(() => window.desktopApp.state());
  const ready = (name = null) => page.waitForFunction(name => {
    const state = window.desktopApp?.state();
    return state && !state.busy && (name === null || state.document?.filename === name);
  }, name);
  const status = () => page.locator('#status').innerText();
  const setPicker = value => app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: !value, filePaths: value ? [value] : [] });
  }, value);
  async function pick(file) { await setPicker(file); await openFile(page); await ready(path.basename(file)); }
  async function tab(file) { await page.locator('.tab-open', { hasText: path.basename(file) }).click(); await ready(path.basename(file)); }
  const openFolders = () => documentMenu(page, '#resource-folders-open');
  const listed = () => page.locator('#resource-folder-list li');
  async function add(folder = assets) {
    await setPicker(folder);
    if (!(await page.locator('#resource-folders-dialog').isVisible())) await openFolders();
    await page.click('#resource-folder-add'); await ready();
  }
  const resourceUrl = ref => page.evaluate(ref => globalThis.platform.document.toResourceUrl(ref), ref);
  const request = url => page.evaluate(url => fetch(url).then(res => res.status), url);
  const width = () => page.locator('#markdown-content img[alt="Shared image"]').evaluate(img => img.naturalWidth);

  try {
    await launch();
    let grantedUrl;
    await t.test('native folder choice unlocks images and fonts but not source files or escaping links', async () => {
      await pick(markdown);
      const denied = await resourceUrl(imageRef);
      assert.equal(await request(denied), 403);
      await add(null);
      assert.equal(await listed().count(), 0);
      await add(path.parse(assets).root);
      assert.match(await page.locator('#resource-folder-status').innerText(), /无法授权此目录/);
      await add();
      assert.equal(await listed().count(), 1);
      assert.match(await listed().innerText(), /资源 #/);
      await closeDialogs(page);
      assert.equal(await width(), 48, await status());
      grantedUrl = await resourceUrl(imageRef);
      assert.equal(await request(grantedUrl), 200);
      assert.equal(await request(denied), 403);
      for (const ref of [pathToFileURL(path.join(assets, imageName)).href, `../${folderName}/extra.woff2`]) assert.equal(await request(await resourceUrl(ref)), 200);
      for (const ref of [`../${folderName}/other.md`, `../${folderName}/table.csv`, `../${folderName}/escape/hidden.png`]) assert.equal(await request(await resourceUrl(ref)), 403);
      assert.equal(await fs.readFile(markdown, 'utf8'), source);
    });

    await t.test('switching tabs isolates the grants and Word/PDF exports inherit the correct scope', async () => {
      await pick(peer);
      assert.equal(await request(grantedUrl), 403);
      assert.equal(await request(await resourceUrl(imageRef)), 403);
      await tab(markdown);
      assert.equal(await width(), 48);
      for (const format of ['docx', 'pdf']) {
        const output = path.join(temporary, `extra-resource.${format}`);
        await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, output);
        await exportFile(page, format);
        await page.waitForFunction(() => !window.desktopApp.state().exporting);
        assert.match(await status(), /已保存/);
        const bytes = await fs.readFile(output);
        if (format === 'docx') assert.ok(Object.keys(unzipSync(bytes)).some(name => name.startsWith('word/media/')));
        else assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      }
    });

    await t.test('revoking a folder invalidates old URLs and cancels an export that holds the grant', async () => {
      assert.equal(await page.locator('#export-open').isEnabled(), true, await status());
      const url = await resourceUrl(imageRef);
      const output = path.join(temporary, 'revoked.pdf');
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = () => new Promise(resolve => { globalThis.finishResourceExport = resolve; });
      });
      await exportFile(page, 'pdf');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await openFolders();
      await listed().locator('button').click(); await ready();
      assert.equal(await listed().count(), 0);
      await closeDialogs(page);
      await app.evaluate((_electron, filePath) => { globalThis.finishResourceExport({ canceled: false, filePath }); }, output);
      await page.waitForFunction(() => !window.desktopApp.state().exporting);
      assert.equal(await request(url), 403);
      assert.equal(await request(await resourceUrl(imageRef)), 403);
      await assert.rejects(fs.access(output), { code: 'ENOENT' });
    });

    await t.test('Vega, Slidev and isolated HTML consume only the resources authorized for their own tabs', async () => {
      await pick(chart);
      assert.equal((await state()).preview.current, false);
      await add(); await closeDialogs(page);
      assert.equal(await page.locator('.diagram-block[data-plugin-type="vega-lite"] img').count(), 1);
      assert.equal((await state()).preview.current, true, await status());
      await pick(slides);
      assert.match(await status(), /资源不可用/);
      await add(); await closeDialogs(page);
      assert.match(await status(), /演示文稿已就绪/);
      const slide = page.frameLocator('#slidev-frame');
      assert.equal(await slide.locator('img[alt="Shared image"]').first().evaluate(img => img.naturalWidth), 48);
      await pick(html);
      await add(); await closeDialogs(page);
      const guest = script => app.evaluate(({ BrowserWindow }, script) => BrowserWindow.getAllWindows()
        .find(window => window.webContents.getURL() === 'documd://viewer/index.html').contentView.children
        .find(child => child.webContents?.getURL().startsWith('documd://html-')).webContents.executeJavaScript(script), script);
      const result = await guest(`(async () => {
        await document.fonts.ready;
        const script = await fetch('../${folderName}/script.js').then(res => res.status, () => 0);
        return [document.images[0].naturalWidth, [...document.fonts].some(font => font.family === 'Extra' && font.status === 'loaded'),
          getComputedStyle(document.querySelector('h1')).color, script];
      })()`);
      assert.deepEqual(result, [48, true, 'rgb(20, 30, 40)', 403]);
    });

    await t.test('a replaced directory and a reopened tab require a new explicit grant', async () => {
      await tab(markdown);
      await add(); await closeDialogs(page);
      const url = await resourceUrl(imageRef);
      await fs.rename(assets, `${assets}-archived`);
      await fs.mkdir(assets);
      await fs.copyFile(icon, path.join(assets, imageName));
      assert.equal(await request(url), 403);
      await page.locator('.document-tab', { has: page.locator('.tab-open', { hasText: 'main.md' }) }).locator('.tab-close').click();
      await ready();
      await pick(markdown);
      assert.deepEqual((await state()).document.resourceFolders, []);
      await add(); await closeDialogs(page);
      assert.equal(await width(), 48);
      await app.close(); app = null;
      await launch(); await ready('main.md');
      assert.deepEqual((await state()).document.resourceFolders, []);
      assert.equal(await request(await resourceUrl(imageRef)), 403);
    });
  } finally { await app?.close(); }
});
