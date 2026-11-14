import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchDesktop, openFile } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const diagram = label => '\n```mermaid\nflowchart LR\nA --> ' + label + '\n```\n';
const body = label => '# ' + label + '\n\n' + Array.from({ length: 80 }, (_, index) =>
  '## Section ' + index + '\n\nA paragraph in the reading viewport.\n\n').join('') + diagram(label);

test('opening a Markdown document preserves the reader scroll and permits switching away from a pending diagram', { timeout: 90000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'progressive-reading');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const reference = path.join(folder, 'Reference.md');
  const slowScroll = path.join(folder, 'SlowScroll.md');
  const slowSwitch = path.join(folder, 'SlowSwitch.md');
  await Promise.all([fs.writeFile(reference, '# Reference\n' + diagram('Reference')),
    fs.writeFile(slowScroll, body('Scroll')), fs.writeFile(slowSwitch, body('Switch'))]);
  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });

  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    const ready = file => page.waitForFunction(name => {
      const state = window.desktopApp.state();
      return !state.busy && state.document?.filename === name && state.preview.current;
    }, path.basename(file));
    async function pick(file) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await openFile(page);
    }
    const worker = source => app.evaluate(({ BrowserWindow }, source) => {
      const host = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'documd://render/render-host.html');
      return host.webContents.executeJavaScript(source);
    }, source);
    async function hold() {
      await worker(`
        window.__progressivePending = new Promise(started => {
          const render = window.renderHost;
          window.renderHost = async (...args) => {
            window.renderHost = render;
            await new Promise(resume => { window.__progressiveResume = resume; started(); });
            return render(...args);
          };
        });
        undefined;
      `);
    }
    await pick(reference);
    await ready(reference);

    await t.test('first viewport scroll survives completion', async () => {
      await hold();
      await pick(slowScroll);
      await worker('window.__progressivePending');
      const reader = page.locator('#reader');
      const bounds = await reader.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 1100);
      await page.waitForFunction(() => document.getElementById('reader').scrollTop > 600);
      const before = await reader.evaluate(node => node.scrollTop);
      assert.equal(await page.locator('#open').isDisabled(), true, 'the document is still rendering');
      await worker('window.__progressiveResume(); undefined');
      await ready(slowScroll);
      const after = await reader.evaluate(node => node.scrollTop);
      assert.ok(Math.abs(before - after) < 24, `the viewport moved from ${before} to ${after}`);
    });

    await t.test('keyboard can leave a stalled render and return to a working document', async () => {
      await hold();
      await pick(slowSwitch);
      await worker('window.__progressivePending');
      const active = page.locator('.tab-open[aria-selected="true"]');
      assert.equal(await active.isDisabled(), false);
      assert.equal(await page.locator('#open').isDisabled(), true);
      await active.focus();
      // Tabs are Reference, SlowScroll, SlowSwitch; go right to wrap to Reference.
      await page.keyboard.press('ArrowRight');
      await ready(reference);
      await page.waitForFunction(() => document.activeElement?.textContent === 'Reference.md');
      assert.match(await page.locator('#status').textContent(), /预览完成/);
      assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), []);
      // The canceled tab stays open and can be rendered again.
      await page.locator('.tab-open', { hasText: 'SlowSwitch.md' }).click();
      await ready(slowSwitch);
      assert.equal(await page.locator('#markdown-content .diagram-block img').count(), 1);
    });
  } finally { await app.close(); }
});
