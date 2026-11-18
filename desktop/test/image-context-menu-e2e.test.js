import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '../node_modules/@napi-rs/canvas/index.js';
import { launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const pngSignature = '89504e470d0a1a0a';

test('desktop image menu saves original and native formats and copies full resolution PNG', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'image-context-menu');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const markdown = path.join(folder, '菜单.md');
  const original = path.join(folder, '原图 #.jpg');
  const vector = path.join(folder, '原图.svg');
  const canvas = createCanvas(48, 36);
  const context = canvas.getContext('2d');
  context.fillStyle = '#1177aa'; context.fillRect(0, 0, 48, 36);
  const jpg = canvas.toBuffer('image/jpeg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="red"/></svg>';
  const label = 'Deliberately wide diagram label to test display resampling while retaining original quality';
  const mermaid = ['A', 'B', 'C', 'D'].map(id => id + '[' + label + ']').join(' --> ');
  await Promise.all([fs.writeFile(original, jpg), fs.writeFile(vector, svg),
    fs.writeFile(markdown, '# Image menu\n\n![JPEG](./原图%20%23.jpg)\n\n' +
      '```mermaid\nflowchart LR\n' + mermaid + '\n```\n\n```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n')]);
  const app = await launchDesktop({
    executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const ready = name => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null ? !state.document : state.document?.filename === name && state.preview.current);
    }, name);
    await app.evaluate(({ dialog, clipboard }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      clipboard.write = async ([item]) => {
        const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
        globalThis.__menuClipboard = {
          size: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
          signature: png.subarray(0, 8).toString('hex'),
        };
      };
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.__menuSaveOptions = options;
        return { canceled: !globalThis.__menuDestination, filePath: globalThis.__menuDestination };
      };
    });
    async function pick(file) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await openFile(page);
      await ready(path.basename(file));
    }
    const menu = page.locator('#shell-popover [data-shell-menu="image"]');
    const item = choice => menu.locator(`[data-image-action="${choice}"]`);
    const choices = () => menu.locator('button:not([hidden])').evaluateAll(buttons => buttons.map(button => button.dataset.imageAction));
    const status = text => page.waitForFunction(text => document.getElementById('status').textContent.includes(text), text);
    const jpgImage = page.locator('#markdown-content img[alt="JPEG"]');
    const mermaidImage = page.locator('#markdown-content .diagram-block img').nth(0);
    const plantImage = page.locator('#markdown-content .diagram-block img').nth(1);
    async function openMenu(image) {
      await image.evaluate(image => image.decode());
      await image.click({ button: 'right' });
      await menu.waitFor();
    }
    async function save(image, format, file, message = '已保存图片') {
      await app.evaluate((_electron, destination) => { globalThis.__menuDestination = destination; }, file);
      await openMenu(image);
      await item(format).click();
      await status(message);
    }
    await ready(null);
    await pick(markdown);

    await t.test('ordinary JPEG keeps original bytes and has a keyboard accessible PNG copy', async () => {
      const output = path.join(folder, '输出.jpeg');
      await save(jpgImage, 'original', output);
      assert.deepEqual(await choices(), ['original', 'copy']);
      assert.deepEqual(await fs.readFile(output), jpg);
      const options = await app.evaluate(() => globalThis.__menuSaveOptions);
      assert.equal(path.basename(options.defaultPath), path.basename(original));
      await jpgImage.focus();
      await page.keyboard.press('Shift+F10');
      await menu.waitFor();
      assert.equal(await item('original').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('End');
      assert.equal(await item('copy').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Enter');
      await status('已将图片复制到剪贴板');
      assert.deepEqual(await app.evaluate(() => globalThis.__menuClipboard), { size: { width: 48, height: 36 }, signature: pngSignature });
    });

    await t.test('diagram export uses the original PNG and only offers engine supplied formats', async () => {
      await openMenu(mermaidImage);
      assert.deepEqual(await choices(), ['png', 'svg', 'copy']);
      const png = await mermaidImage.evaluate(async image => {
        const source = window.desktopViewer.originalImageSource(image);
        const original = new Image(); original.src = source; await original.decode();
        return { base64: source.split(',')[1], width: original.naturalWidth, height: original.naturalHeight, displayed: image.naturalWidth };
      });
      assert.ok(png.width > png.displayed, 'reader downsamples this diagram for display');
      await app.evaluate(() => { globalThis.__menuClipboard = null; });
      await item('copy').click();
      await status('已将图片复制到剪贴板');
      const destination = path.join(folder, 'diagram.png');
      await save(mermaidImage, 'png', destination);
      assert.deepEqual(await fs.readFile(destination), Buffer.from(png.base64, 'base64'));
      assert.deepEqual(await app.evaluate(() => globalThis.__menuClipboard), { size: { width: png.width, height: png.height }, signature: pngSignature });
      const svgPath = path.join(folder, 'diagram.svg');
      await save(mermaidImage, 'svg', svgPath);
      assert.match(await fs.readFile(svgPath, 'utf8'), /<svg\b/);
      const xml = path.join(folder, 'diagram.drawio');
      await save(plantImage, 'drawio', xml);
      assert.match(await fs.readFile(xml, 'utf8'), /<mx(?:file|GraphModel)\b/);
    });

    await t.test('keyboard dismissal, canceled save and standalone SVG preserve the source', async () => {
      const zoom = mermaidImage.locator('..').locator('.desktop-diagram-open');
      await zoom.focus();
      await page.keyboard.press('Shift+F10');
      await menu.waitFor();
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      assert.equal(await zoom.evaluate(node => node === document.activeElement), true);
      await save(jpgImage, 'original', null, '已取消导出');
      await pick(vector);
      const standalone = page.locator('#image-file-view img');
      await save(standalone, 'original', vector, '不能覆盖已打开的源文件');
      assert.deepEqual(await choices(), ['original', 'copy']);
      assert.equal(await fs.readFile(vector, 'utf8'), svg);
      await openMenu(standalone);
      await item('copy').click();
      await status('已将图片复制到剪贴板');
      assert.deepEqual(await app.evaluate(() => globalThis.__menuClipboard), { size: { width: 60, height: 20 }, signature: pngSignature });
      await openMenu(standalone);
      await page.evaluate(() => {
        const state = window.desktopApp.state();
        return window.desktopApp.activate(state.tabs.find(tab => tab.documentId !== state.document.documentId).documentId);
      });
      await ready(path.basename(markdown));
      await menu.waitFor({ state: 'hidden' });
    });
  } finally { await app.close(); }
});
