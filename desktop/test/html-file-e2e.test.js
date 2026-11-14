import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { closeDialogs, documentMenu, launchDesktop, openFile, openSettings, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('local HTML previews use an isolated native view with scoped resources', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results', 'desktop', executable ? 'packaged' : 'development', 'html-file');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, '工作区');
  const assets = path.join(workspace, 'assets');
  const name = '页面 #%.HTML';
  const html = path.join(workspace, 'pages', name);
  const markdown = path.join(workspace, '回归.md');
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(path.dirname(html), { recursive: true });
  const source = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="../assets/style.css"></head>
<body><h1>本地页面</h1><button id="run">运行本地脚本</button><p id="result"></p>
<img id="icon" src="../assets/图片%20%23.png" alt="本机图片">
<script type="module" src="../assets/preview.mjs"></script>
<script>window.inlineScriptRan = true;</script></body></html>`;
  await Promise.all([
    fs.writeFile(html, source),
    fs.writeFile(markdown, '# Markdown 正文'),
    fs.writeFile(path.join(folder, 'outside.js'), 'window.outsideLoaded = true;'),
    fs.writeFile(path.join(assets, 'style.css'), 'h1 { color: rgb(40, 90, 120) }'),
    fs.writeFile(path.join(assets, 'preview.mjs'), `
      document.querySelector('#run').addEventListener('click', async () => {
        const data = await fetch('../assets/data.json').then(response => response.json());
        document.querySelector('#result').textContent = data.message;
      });
      window.localModuleRan = true;
    `),
    fs.writeFile(path.join(assets, 'data.json'), JSON.stringify({ message: '本地模块与 JSON 已加载' })),
    fs.copyFile(path.join(root, 'test/fixtures/layout/assets/icon48.png'), path.join(assets, '图片 #.png')),
  ]);
  await fs.symlink(folder, path.join(assets, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');

  let app, page;
  async function launch() {
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.desktopApp) && !document.getElementById('open').disabled);
  }
  async function ready(filename) {
    await page.waitForFunction(filename => {
      const state = window.desktopApp.state();
      return !state.busy && state.document?.filename === filename;
    }, filename);
    assert.equal(await page.evaluate(() => window.desktopApp.state().preview.current), true, await page.locator('#status').innerText());
  }
  async function pick(file, open = openFile) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await open(page);
  }
  const guest = (script = null) => app.evaluate(async ({ BrowserWindow, session }, script) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'documd://viewer/index.html');
    const view = window.contentView.children.find(child => child.webContents && child.webContents !== window.webContents);
    if (!view) return null;
    if (script) return view.webContents.executeJavaScript(script);
    return { id: view.webContents.id, visible: view.getVisible(), bounds: view.getBounds(),
      url: view.webContents.getURL(), separate: view.webContents.session !== session.defaultSession };
  }, script);
  async function waitVisible(visible) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const state = await guest();
      if (state?.visible === visible) return state;
      await wait(25);
    }
    const shell = await page.evaluate(() => ({
      rect: document.getElementById('html-file-view').getBoundingClientRect().toJSON(),
      overlays: Array.from(document.querySelectorAll('dialog[open], #shell-popover:not([hidden]), #desktop-app.sidebar-drawer, #drop-overlay:not([hidden])'), node => node.id),
      status: document.getElementById('status').textContent,
    }));
    assert.fail(`HTML view did not become ${visible ? 'visible' : 'hidden'}: ${JSON.stringify({ shell, guest: await guest() })}`);
  }
  try {
    await launch();
    let firstId;
    await t.test('workspace HTML loads relative styles, images, scripts and JSON in an independent session', async () => {
      await pick(workspace, openWorkspace);
      await page.locator('.tree-dir[data-name="pages"]').click();
      await page.locator('.tree-file', { hasText: name }).click();
      await ready(name);
      const state = await waitVisible(true);
      firstId = state.id;
      assert.equal(state.separate, true);
      assert.ok(state.bounds.width > 300 && state.bounds.height > 200);
      assert.equal(await page.locator('#save-indicator').textContent(), '只读');
      assert.equal(await page.locator('#export-open').isDisabled(), true);
      assert.match(await page.locator('#status').innerText(), /外部资源已禁用/);
      assert.deepEqual(await guest(`[
        document.querySelector('h1').textContent,
        getComputedStyle(document.querySelector('h1')).color,
        document.querySelector('#icon').naturalWidth,
        window.inlineScriptRan, window.localModuleRan
      ]`), ['本地页面', 'rgb(40, 90, 120)', 48, true, true]);
      await guest("document.querySelector('#run').click(); undefined");
      for (let attempt = 0; attempt < 60 && !await guest("document.querySelector('#result').textContent"); attempt++) await wait(25);
      assert.equal(await guest("document.querySelector('#result').textContent"), '本地模块与 JSON 已加载');
    });

    await t.test('HTML cannot use app APIs, open windows or load remote and out-of-scope resources', async () => {
      const result = await guest(`(async () => {
        const check = url => fetch(url).then(response => response.ok, () => false);
        let storage = true;
        try { void localStorage.length; } catch { storage = false; }
        const local = new RTCPeerConnection(), remote = new RTCPeerConnection();
        let peerStates;
        try {
          local.createDataChannel('local-test');
          await local.setLocalDescription(await local.createOffer());
          await remote.setRemoteDescription(local.localDescription);
          await remote.setLocalDescription(await remote.createAnswer());
          await local.setRemoteDescription(remote.localDescription);
          peerStates = [local.iceConnectionState, remote.iceConnectionState];
        } finally {
          local.close();
          remote.close();
        }
        return {
          exposed: [typeof desktop, typeof require, typeof process], storage, peerStates,
          popup: window.open('https://example.invalid') !== null,
          assets: await Promise.all(['../assets/outside/outside.js', '../回归.md', 'documd://viewer/index.html',
            'https://example.invalid/test.json'].map(check)),
        };
      })()`);
      assert.deepEqual(result, {
        exposed: ['undefined', 'undefined', 'undefined'], storage: false, peerStates: ['failed', 'failed'], popup: false,
        assets: [false, false, false, false],
      });
      const before = await guest();
      await guest("location.href = 'https://example.invalid'; undefined");
      for (let attempt = 0; attempt < 60; attempt++) {
        await wait(25);
        if (await guest("document.querySelector('h1')?.textContent") === '本地页面') break;
      }
      assert.equal((await guest()).url, before.url);
      assert.equal(await guest("document.querySelector('h1').textContent"), '本地页面');
    });

    await t.test('menus and settings stay above the preview, and switching tabs destroys the guest', async () => {
      await page.locator('[data-shell-action="file-menu"]').click();
      await waitVisible(false);
      await page.locator('#open').press('Escape');
      await page.locator('#shell-popover').waitFor({ state: 'hidden' });
      await waitVisible(true);
      await openSettings(page);
      await waitVisible(false);
      await closeDialogs(page);
      await waitVisible(true);
      await pick(markdown);
      await ready('回归.md');
      assert.equal(await guest(), null);
      assert.equal(await page.locator('#markdown-content h1').innerText(), 'Markdown 正文');
      assert.equal(await page.locator('#export-open').isEnabled(), true);
      await page.locator('.tab-open', { hasText: name }).click();
      await ready(name);
      assert.notEqual((await waitVisible(true)).id, firstId);
    });

    await t.test('reloading and restarting restores the isolated HTML tab with updated bytes', async () => {
      await page.uncheck('#auto-refresh');
      await fs.writeFile(html, source.replace('本地页面', '重新载入页面'));
      await documentMenu(page, '#reload-file');
      await ready(name);
      assert.equal(await guest("document.querySelector('h1').textContent"), '重新载入页面');
      await app.close();
      app = null;
      await launch();
      await ready(name);
      assert.equal(await guest("document.querySelector('h1').textContent"), '重新载入页面');
      assert.equal(await page.locator('.document-tab').count(), 2);
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const view = window.contentView.children.find(child => child.webContents?.getURL().startsWith('documd://html-'));
        view.webContents.forcefullyCrashRenderer();
      });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('本地 HTML 预览失败'));
      assert.equal(await guest(), null);
      await documentMenu(page, '#reload-file');
      await ready(name);
      assert.equal(await guest("document.querySelector('h1').textContent"), '重新载入页面');
    });
  } finally {
    await app?.close();
  }
});
