import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { launchDesktop, openFile, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('packaged Slidev opens offline, switches views and prints one page per slide', { timeout: 150000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'slidev');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, 'workspace');
  const decks = path.join(workspace, 'decks');
  const assets = path.join(workspace, 'assets');
  await Promise.all([fs.mkdir(decks, { recursive: true }), fs.mkdir(assets, { recursive: true })]);
  const file = path.join(decks, '演示 #%.SLIDES.MD');
  const bad = path.join(decks, '缺图.slides.md');
  const plain = path.join(decks, 'ordinary.md');
  const themes = ['default', 'seriph', 'apple-basic', 'bricks', 'dracula', 'purplin', 'academic', 'geist', 'unicorn'];
  const source = `---
theme: seriph
title: Offline deck
canvasWidth: 960
aspectRatio: '16/9'
background: ../assets/图%20%23.png
---

# Offline opening

Math: $x^2$.

![Workspace image](../assets/图%20%23.png)

<script>window.deckScriptRan = true</script>

---

# Local diagram

\`\`\`mermaid
flowchart LR
  A[Offline] --> B[Packaged]
\`\`\`

---
layout: image-right
image: ../assets/图%20%23.png
---

# Last slide

<v-click>

Reveal in static output.

</v-click>
`;
  await Promise.all([
    fs.writeFile(file, source),
    fs.writeFile(bad, '---\ntheme: not-bundled\n---\n\n# Partial deck\n\n![remote](https://example.invalid/x.png)\n\n![outside](../assets/outside/secret.png)\n'),
    fs.writeFile(plain, '# Ordinary Markdown'),
    ...themes.map(theme => fs.writeFile(path.join(decks, `${theme}.slides.md`), `---\ntheme: ${theme}\n---\n\n# Theme ${theme}\n`)),
    fs.copyFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'), path.join(assets, '图 #.png')),
    fs.copyFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'), path.join(folder, 'secret.png')),
    fs.symlink(folder, path.join(assets, 'outside'), process.platform === 'win32' ? 'junction' : 'dir'),
  ]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    const status = () => page.locator('#status').innerText();
    const frame = page.frameLocator('#slidev-frame');
    const ready = name => page.waitForFunction(name => {
      const state = window.desktopApp?.state();
      return state && !state.busy && (name === null || state.document?.filename === name);
    }, name);
    const count = text => page.waitForFunction(text => document.getElementById('slidev-count').textContent === text, text);
    const pick = filePath => app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: !filePath, filePaths: filePath ? [filePath] : [] });
    }, filePath);
    async function workspaceFile(filePath) {
      await page.locator('.tree-file', { hasText: path.basename(filePath) }).click();
      await ready(path.basename(filePath));
    }
    await ready(null);

    await t.test('scoped presentation loads the bundled theme and supports navigation, list and full screen', async () => {
      await pick(workspace);
      await openWorkspace(page);
      await page.locator('.tree-dir[data-name="decks"]').click();
      await workspaceFile(file);
      assert.match(await status(), /演示文稿已就绪/);
      assert.equal(await page.locator('#save').isDisabled(), true);
      await count('1 / 3');
      await frame.getByRole('heading', { name: 'Offline opening' }).first().waitFor();
      const info = await frame.locator('body').evaluate(async () => ({
        origin: location.host, mode: document.documentElement.classList.contains('dark'),
        theme: Boolean(window.__SLIDEV_THEME__), bridge: typeof window.desktop, script: window.deckScriptRan,
        width: (await Promise.all(Array.from(document.querySelectorAll('img[alt="Workspace image"]'), async img => {
          await img.decode(); return img.naturalWidth;
        })))[0],
        mathFont: [...document.fonts].some(font => font.family === 'KaTeX_Math' && font.status === 'loaded'),
        privileged: await fetch('documd://slides/main.cjs').then(res => res.status),
        remote: await fetch('https://example.invalid/').then(() => false, () => true),
      }));
      assert.deepEqual(info, { origin: 'slides', mode: false, theme: true, bridge: 'undefined', script: undefined,
        width: 48, mathFont: true, privileged: 403, remote: true });
      await page.click('#slidev-next'); await count('2 / 3');
      await frame.locator('img[alt="mermaid"]').first().waitFor();
      await page.click('#slidev-prev'); await count('1 / 3');
      await page.click('#slidev-next'); await count('2 / 3');
      await page.click('#slidev-list');
      await frame.locator('.slidev-list-item').nth(2).waitFor();
      await count('3 张幻灯片');
      assert.equal(await frame.locator('.slidev-list-item').count(), 3);
      await page.click('#slidev-presentation'); await count('2 / 3');
      await page.click('#slidev-fullscreen');
      await page.waitForFunction(() => document.getElementById('slidev-view').hasAttribute('data-fullscreen') && !document.getElementById('slidev-fullscreen').disabled);
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible()).isFullScreen()), true);
      await page.click('#slidev-fullscreen');
      await page.waitForFunction(() => !document.getElementById('slidev-view').hasAttribute('data-fullscreen') && !document.getElementById('slidev-fullscreen').disabled);
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible()).isFullScreen()), false);
      await pick(null); await openFile(page); await ready(path.basename(file));
      await count('2 / 3');
      assert.equal(await page.locator('#slidev-frame').count(), 1);
    });

    await t.test('static PDF preview and save preserve the deck dimensions, page order and click content', async () => {
      const output = path.join(folder, 'offline-slides.pdf');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, output);
      await page.click('#export-open');
      assert.equal(await page.locator('[data-export-format="docx"]').isVisible(), false);
      assert.equal(await page.locator('[data-export-format="html"]').isVisible(), false);
      assert.equal(await page.locator('[data-export-format="png"]').isVisible(), false);
      assert.match(await page.locator('#export-slidev-note').innerText(), /每张幻灯片一页/);
      assert.equal(await page.locator('#pdf-options').isHidden(), true);
      await page.click('#pdf-preview-start');
      await page.waitForFunction(() => /第 1 \/ 3 页/.test(document.getElementById('pdf-preview-status').textContent));
      assert.ok(await page.locator('#pdf-preview-canvas').evaluate(canvas => Math.abs(canvas.width / canvas.height - 16 / 9) < 0.02));
      await page.click('#export-start');
      await page.waitForFunction(() => !window.desktopApp.state().exporting, null, { timeout: 45000 });
      assert.match(await status(), /已保存/);
      const bytes = await fs.readFile(output);
      const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const pdf = await loading.promise;
      try {
        assert.equal(pdf.numPages, 3);
        for (const [index, title] of ['Offline opening', 'Local diagram', 'Last slide'].entries()) {
          const slide = await pdf.getPage(index + 1);
          const { width, height } = slide.getViewport({ scale: 1 });
          assert.ok(Math.abs(width / height - 16 / 9) < 0.02, `PDF slide size ${width}×${height}`);
          const text = (await slide.getTextContent()).items.map(item => item.str || '').join(' ');
          assert.ok(text.includes(title), text);
          const imageCount = (await slide.getOperatorList()).fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
          assert.ok(imageCount >= (index === 0 ? 2 : 1), `${title}: ${imageCount} image(s)`);
          if (index === 2) assert.match(text, /Reveal in static output/);
        }
      } finally { await loading.destroy(); }
      await count('2 / 3');
      assert.equal(await fs.readFile(file, 'utf8'), source);
    });

    await t.test('unavailable resources stay visible as diagnostics and prevent exporting an incomplete deck', async () => {
      await workspaceFile(bad);
      assert.match(await status(), /2 处资源不可用/);
      assert.equal(await page.locator('#export-open').isDisabled(), true);
      await frame.getByRole('heading', { name: 'Partial deck' }).first().waitFor();
      assert.match(await frame.locator('#app').innerText(), /图片不可用/);
      const fallback = await frame.locator('body').evaluate(() => Boolean(window.__SLIDEV_THEME__));
      assert.equal(fallback, true);
      await workspaceFile(plain);
      assert.equal(await page.locator('#slidev-frame').count(), 0);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Ordinary Markdown');
    });

    await t.test('all nine shipped themes mount from the application package', async () => {
      for (const theme of themes) {
        await workspaceFile(path.join(decks, `${theme}.slides.md`));
        assert.match(await status(), /演示文稿已就绪/, theme);
        await frame.getByRole('heading', { name: `Theme ${theme}`, exact: true }).first().waitFor();
        const loaded = await frame.locator('body').evaluate(() => ({ theme: window.__SLIDEV__.configs.theme, layouts: Object.keys(window.__SLIDEV_THEME__.layouts).length }));
        assert.equal(loaded.theme, theme);
        assert.ok(loaded.layouts > 0, theme);
      }
    });
  } finally { await app.close(); }
});
