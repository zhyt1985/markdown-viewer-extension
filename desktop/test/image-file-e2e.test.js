import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchDesktop, openFile, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const icon = size => path.join(root, 'test', 'fixtures', 'layout', 'assets', `icon${size}.png`);

test('standalone image files open offline, zoom and restore through the desktop shell', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results', 'desktop', executable ? 'packaged' : 'development', 'image-file');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, '图片工作区');
  await fs.mkdir(workspace);
  const png = path.join(workspace, '图片 #%.PNG');
  const svg = path.join(workspace, '矢量.svg');
  const invalid = path.join(workspace, '损坏.png');
  const markdown = path.join(workspace, '文档.md');
  const vector = (await fs.readFile(path.join(root, 'test', 'fixtures', 'diagrams', 'simple.svg'), 'utf8'))
    .replace('width="120" height="60"', 'width="1600" height="800"');
  await Promise.all([
    fs.copyFile(icon(48), png),
    fs.writeFile(svg, vector.replace('</svg>', '<script>window.imageScriptRan = true;</script></svg>')),
    fs.writeFile(invalid, 'Not an image'),
    fs.writeFile(markdown, '# Markdown 正文\n'),
  ]);

  let app, page;
  async function launch() {
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.waitForFunction(() => !document.getElementById('open')?.disabled && Boolean(window.desktopApp));
  }
  const ready = (filename, current = true) => page.waitForFunction(({ filename, current }) => {
    const state = window.desktopApp.state();
    return !state.busy && state.document?.filename === filename && state.preview.current === current;
  }, { filename, current });
  const image = () => page.locator('#image-file-view img');
  const dimensions = () => page.locator('#image-file-view figcaption').innerText();
  const statusOf = url => page.evaluate(url => fetch(url).then(response => response.status), url);
  async function pick(file, open = openFile) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await open(page);
  }
  try {
    await launch();
    let firstUrl;
    await t.test('the file picker opens PNG at its real resolution and the lightbox zooms it', async () => {
      await pick(png);
      await ready(path.basename(png));
      assert.equal(await image().getAttribute('alt'), path.basename(png));
      assert.equal(await dimensions(), '48 × 48 px');
      assert.equal(await page.locator('#save-indicator').textContent(), '只读');
      assert.equal(await page.locator('.shell-encoding').isHidden(), true);
      assert.equal(await page.locator('#export-open').isDisabled(), true);
      firstUrl = await image().getAttribute('src');
      assert.equal(await statusOf(firstUrl), 200);
      assert.equal(await statusOf(`${firstUrl}/../other.png`), 403);
      const sibling = await page.evaluate(() => `${window.desktopApp.state().document.documentBaseUrl}/文档.md`);
      assert.equal(await statusOf(sibling), 403);
      await page.getByRole('button', { name: '放大查看图片' }).click();
      await page.waitForFunction(() => document.getElementById('diagram-detail').style.opacity === '1');
      assert.equal(await page.locator('#diagram-title').textContent(), '图片预览');
      assert.equal(await page.locator('#diagram-detail').evaluate(node => node.naturalWidth), 48);
      await page.click('#diagram-zoom-in');
      assert.equal(await page.locator('#diagram-zoom').textContent(), '125%');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#diagram-dialog').isHidden(), true);
      assert.equal(await page.getByRole('button', { name: '放大查看图片' }).evaluate(node => node === document.activeElement), true);
    });

    await t.test('SVG from a workspace stays an image and switching invalidates the previous image URL', async () => {
      await pick(workspace, openWorkspace);
      await page.locator('.tree-file[data-name="矢量.svg"]').click();
      await ready('矢量.svg');
      assert.equal(await dimensions(), '1600 × 800 px');
      assert.ok(await image().evaluate(node => node.clientWidth > 0
        && node.clientWidth < node.naturalWidth
        && node.getBoundingClientRect().right <= node.closest('#reader').getBoundingClientRect().right));
      assert.equal(await page.locator('#image-file-view :is(svg, iframe, object, script)').count(), 0);
      assert.equal(await page.evaluate(() => window.imageScriptRan), undefined);
      assert.equal(await statusOf(firstUrl), 403);
      const policy = await image().evaluate(async node => {
        const response = await fetch(node.src);
        return [response.headers.get('content-type'), response.headers.get('content-security-policy')];
      });
      assert.equal(policy[0], 'image/svg+xml');
      assert.match(policy[1], /sandbox; default-src 'none'/);
    });

    await t.test('a damaged image reports failure and Markdown still opens with its editor available', async () => {
      await page.locator('.tree-file[data-name="损坏.png"]').click();
      await ready('损坏.png', false);
      assert.match(await page.locator('#operation-status').innerText(), /图片无法加载：损坏\.png/);
      assert.equal(await image().count(), 0);
      await page.locator('.tree-file[data-name="文档.md"]').click();
      await ready('文档.md');
      assert.equal(await page.locator('#image-file-view').isHidden(), true);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Markdown 正文');
      assert.equal(await page.locator('#edit-toggle').isEnabled(), true);
      assert.equal(await page.locator('#export-open').isEnabled(), true);
    });

    await t.test('auto-refresh replaces the image and a restart restores the current image tab', async () => {
      await page.locator('.tab-open', { hasText: path.basename(png) }).click();
      await ready(path.basename(png));
      const previousUrl = await image().getAttribute('src');
      const replacement = path.join(workspace, 'replacement.tmp');
      await fs.copyFile(icon(128), replacement);
      await fs.rename(replacement, png);
      await page.waitForFunction(() => document.querySelector('#image-file-view img')?.naturalWidth === 128);
      await ready(path.basename(png));
      assert.equal(await dimensions(), '128 × 128 px');
      assert.equal(await statusOf(previousUrl), 403);
      await page.screenshot({ path: path.join(artifacts, 'image.png'), scale: 'css' });
      await app.close();
      app = null;
      await launch();
      await ready(path.basename(png));
      assert.equal(await dimensions(), '128 × 128 px');
      assert.equal(await page.locator('.document-tab').count(), 4);
    });
  } finally {
    await app?.close();
  }
});
