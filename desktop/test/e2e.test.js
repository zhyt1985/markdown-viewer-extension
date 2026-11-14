import { launchDesktop, openFile, openWorkspace, exportFile, cancelExport, openSettings, closeDialogs, selectNav, documentMenu } from './ui-helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '../node_modules/@napi-rs/canvas/index.js';
import { getDocument } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));

async function waitFor(page, expression, timeout = 90000) {
  const deadline = Date.now() + timeout;
  do {
    if (await page.evaluate(expression)) return;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${expression}; status: ${await page.locator('#status').innerText()}`);
}

function zipEntries(bytes) {
  // Read the ZIP central directory (including files whose sizes use data descriptors).
  const entries = new Map();
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
  }
  return entries;
}

test('real desktop runtime: offline preview, exports and file boundaries', { timeout: 240000 }, async (t) => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development');
  await fs.mkdir(artifacts, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const folder = path.join(temporary, '中文 文档');
  await fs.mkdir(folder);
  const input = path.join(folder, '验证 示例.md');
  const source = '# 桌面原型验证\n\n本地离线文档，包含公式 $E=mc^2$。\n\n| 项目 | 结果 |\n| --- | --- |\n| 桌面 | 可行 |\n\n![本地图片](./图片%20sample.svg)\n\n```mermaid\nflowchart LR\n  A[打开文件] --> B[本地预览]\n  B --> C[导出文档]\n```\n\n> 引用正文 $a^2$\n\n<script>window.__documentScriptRan = true</script>\n';
  await fs.writeFile(input, source);
  await fs.writeFile(path.join(folder, '图片 sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#205ac7"/><text x="10" y="35" fill="white">Offline image</text></svg>');
  const secret = path.join(temporary, 'outside.txt');
  await fs.writeFile(secret, 'must not be readable');

  const packaged = process.env.MV_DESKTOP_EXECUTABLE;
  const electron = await launchDesktop({
    executablePath: packaged || require('electron'),
    args: [`--user-data-dir=${path.join(temporary, 'profile')}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
  });
  const logs = [];
  try {
    const page = await electron.firstWindow();
    page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
    await waitFor(page, 'Boolean(window.desktopViewer && window.desktop)');
    assert.equal(await page.evaluate('globalThis.platform.platform'), 'desktop');
    assert.equal(await page.evaluate('typeof window.markdownCli'), 'undefined');
    await electron.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, input);
    await openFile(page);
    await waitFor(page, '!document.querySelector("#open").disabled');
    // The shared renderer embeds local images as data URLs; retain the source capability explicitly.
    let originalImage = await page.evaluate('globalThis.platform.document.toResourceUrl("./图片%20sample.svg")');

    await t.test('renders Chinese paths, relative images, math, tables and Mermaid offline', async () => {
      assert.match(await page.locator('#status').innerText(), /预览完成/);
      assert.equal(await page.locator('#markdown-content h1').innerText(), '桌面原型验证');
      assert.equal(await page.locator('#markdown-content table').count(), 1);
      assert.ok(await page.locator('#markdown-content .katex').count() > 0);
      assert.ok(await page.locator('#markdown-content .diagram-block').count() > 0);
      assert.deepEqual(await page.evaluate('window.desktopViewer.diagnostics()'), []);
      assert.equal(await page.evaluate('[...document.querySelectorAll("#markdown-content img")].every(i => i.complete && i.naturalWidth > 0)'), true);
      assert.equal(await page.evaluate('window.__documentScriptRan === true'), false);
      await page.screenshot({ path: path.join(artifacts, 'preview.png'), fullPage: true });
    });

    await t.test('keeps Node isolated and denies reads outside the selected directory', async () => {
      assert.equal(await page.evaluate('typeof window.require'), 'undefined');
      assert.equal(await page.evaluate('typeof window.process'), 'undefined');
      for (const url of ['documd://viewer/main.cjs', `documd://viewer/read-file?path=${encodeURIComponent(secret)}`,
        `documd://viewer/read-file?token=invalid&path=${encodeURIComponent(input)}`]) {
        assert.equal(await page.evaluate(`fetch(${JSON.stringify(url)}).then(r => r.status)`), 403);
      }
      // Use the actual resource capability to exercise canonical containment, not just token rejection.
      assert.equal(await page.evaluate(`fetch(${JSON.stringify(originalImage)}).then(r => r.status)`), 200);
      const token = new URL(originalImage).searchParams.get('token');
      assert.equal(await page.evaluate(`fetch(${JSON.stringify(`documd://viewer/read-file?token=${token}&path=${encodeURIComponent(secret)}`)}).then(r => r.status)`), 403);
      assert.equal(await page.evaluate('fetch("https://example.com/").then(() => false, () => true)'), true);
    });

    for (const format of ['docx', 'pdf']) {
      await t.test(`exports real ${format.toUpperCase()} bytes through the system save flow`, async () => {
        const previewBefore = await page.locator('#markdown-page').innerHTML();
        const output = path.join(artifacts, `验证结果.${format}`);
        await electron.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await exportFile(page, format);
        await waitFor(page, '!document.querySelector("#open").disabled && document.querySelector("#cancel-export").disabled');
        assert.match(await page.locator('#status').innerText(), /已保存/);
        assert.equal(await page.locator('#markdown-page').innerHTML(), previewBefore, 'export must not rebuild the foreground document');
        const bytes = await fs.readFile(output);
        assert.ok(bytes.length > 1500);
        if (format === 'pdf') {
          assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
          assert.match(bytes.toString('latin1'), /\/Type\s*\/Page\b/);
          const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true,
            standardFontDataUrl: `${path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/` });
          const pdf = await loading.promise;
          try {
            assert.equal(pdf.numPages, 1, 'the compact fixture should fit on a single A4 page');
            const pdfPage = await pdf.getPage(1);
            const text = (await pdfPage.getTextContent()).items.map(item => item.str || '').join('').normalize('NFKC');
            assert.match(text, /桌面原型验证/);
            assert.doesNotMatch(text, /桌面原型验证.*桌面原型验证/);
            assert.doesNotMatch(text, /打开 Markdown|导出 Word|导出 PDF|正在准备/);
            const viewport = pdfPage.getViewport({ scale: 1.5 });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            await fs.writeFile(path.join(artifacts, 'pdf-page-1.png'), canvas.toBuffer('image/png'));
          } finally { await loading.destroy(); }
        } else {
          assert.equal(bytes.subarray(0, 2).toString(), 'PK');
          const entries = zipEntries(bytes);
          const xml = entries.get('word/document.xml')?.toString() || '';
          assert.match(xml, /桌面原型验证/);
          assert.match(xml, /<m:oMath/);
          assert.match(xml, /引用正文/);
          assert.match(xml, /<w:tbl[ >]/);
          assert.ok([...entries.keys()].some(name => name.startsWith('word/media/')));
        }
      });
    }

    await t.test('clearing cache during a render keeps its preview but prevents an old cache write', async () => {
      await page.evaluate(() => globalThis.platform.cache.clear());
      const workerScript = async source => electron.evaluate(({ BrowserWindow }, script) => {
        const worker = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'documd://render/render-host.html');
        return worker.webContents.executeJavaScript(script);
      }, source);
      await workerScript(`
        window.__cacheProbeStarted = new Promise(started => {
          const render = window.renderHost;
          window.renderHost = async (...args) => {
            window.renderHost = render;
            await new Promise(resolve => { window.__releaseCacheProbe = resolve; started(); });
            return render(...args);
          };
        });
        undefined;
      `);
      await openFile(page);
      await workerScript('window.__cacheProbeStarted');
      try {
        await openSettings(page);
        await page.click('#clear-cache');
        await waitFor(page, 'document.querySelector("#cache-status").textContent.includes("0 项")');
        await closeDialogs(page);
      } finally {
        await workerScript('window.__releaseCacheProbe(); delete window.__releaseCacheProbe; delete window.__cacheProbeStarted;');
        await waitFor(page, '!document.querySelector("#open").disabled');
      }
      assert.match(await page.locator('#status').innerText(), /预览完成/);
      assert.equal(await page.locator('#markdown-content .diagram-block[data-plugin-type="mermaid"]').count(), 1);
      assert.equal((await page.evaluate(() => globalThis.platform.cache.getStats())).itemCount, 0);
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.ok((await page.evaluate(() => globalThis.platform.cache.getStats())).items.some(item => item.type === 'mermaid'));
    });

    await t.test('diagram rendering uses a separate sandboxed process and recovers from a real crash', async () => {
      await page.evaluate('globalThis.platform.cache.clear()');
      const processes = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({
        url: w.webContents.getURL(), pid: w.webContents.getOSProcessId(),
      })));
      const foreground = processes.find(w => w.url.endsWith('/index.html'));
      const render = processes.find(w => w.url === 'documd://render/render-host.html');
      assert.ok(render && foreground && render.pid !== foreground.pid, JSON.stringify(processes));
      assert.equal(await page.evaluate('typeof window.mermaid'), 'undefined');
      await electron.evaluate(async ({ BrowserWindow }) => {
        const worker = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'documd://render/render-host.html');
        await worker.webContents.executeJavaScript('if (typeof window.desktop !== "undefined" || typeof window.require !== "undefined") throw Error("privilege leak"); window.renderHost = () => new Promise(() => {}); undefined');
      });
      await openFile(page);
      await waitFor(page, 'document.querySelector("#open").disabled && document.querySelector("#status").textContent.includes("正在渲染")');
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .find(w => w.webContents.getURL() === 'documd://render/render-host.html').webContents.forcefullyCrashRenderer());
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.match(await page.locator('#status').innerText(), /操作失败/);
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.match(await page.locator('#status').innerText(), /预览完成/);
      originalImage = await page.evaluate('globalThis.platform.document.toResourceUrl("./图片%20sample.svg")');
    });

    await t.test('export keeps its original document and settings while another file is opened', async () => {
      const second = path.join(folder, '另一文档.md');
      await fs.writeFile(second, '# 另一文档\n\n不属于导出快照');
      const output = path.join(artifacts, 'snapshot.docx');
      await electron.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = () => new Promise(resolve => {
          globalThis.__releaseSave = () => resolve({ canceled: false, filePath });
        });
      }, output);
      await exportFile(page, 'docx');
      // Await the held dialog without sleeping for an arbitrary render duration.
      for (let i = 0; i < 100 && !await electron.evaluate(() => typeof globalThis.__releaseSave === 'function'); i++) await page.waitForTimeout(25);
      assert.equal(await electron.evaluate(() => typeof globalThis.__releaseSave), 'function');
      await electron.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, second);
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '另一文档');
      await page.evaluate('globalThis.platform.settings.set("themeId", "minimal")');
      await electron.evaluate(() => { globalThis.__releaseSave(); delete globalThis.__releaseSave; });
      await waitFor(page, 'document.querySelector("#cancel-export").disabled');
      assert.match(await page.locator('#status').innerText(), /已保存/);
      const xml = zipEntries(await fs.readFile(output)).get('word/document.xml').toString();
      assert.match(xml, /桌面原型验证/);
      assert.doesNotMatch(xml, /不属于导出快照/);
      assert.equal(zipEntries(await fs.readFile(output)).get('word/styles.xml').toString(),
        zipEntries(await fs.readFile(path.join(artifacts, '验证结果.docx'))).get('word/styles.xml').toString(),
        'export styles must use the settings snapshot captured before the theme change');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '另一文档');
      await page.evaluate('globalThis.platform.settings.set("themeId", "default")');
      assert.equal(await page.evaluate('window.desktop.exportDocument({format:"pdf",documentId:"stale",documentVersion:"stale"}).then(() => false, () => true)'), true);
      await electron.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, input);
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      originalImage = await page.evaluate('globalThis.platform.document.toResourceUrl("./图片%20sample.svg")');
    });

    await t.test('cancel and crash terminate an active export host without partial output, then a new export succeeds', async () => {
      const output = path.join(artifacts, 'recovery.docx');
      await fs.writeFile(output, 'previous output');
      await electron.evaluate(({ app, dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        globalThis.__holdExport = (_event, contents) => contents.once('did-finish-load', () => {
          if (contents.getURL() === 'documd://export/export.html') {
            void contents.executeJavaScript('window.desktopViewer.exportDocument = () => { window.__held = true; return new Promise(() => {}); }; undefined');
          }
        });
        app.on('web-contents-created', globalThis.__holdExport);
      }, output);
      try {
        for (const action of ['cancel', 'crash']) {
          await exportFile(page, 'docx');
          let held = false;
          for (let i = 0; i < 100 && !held; i++) {
            held = await electron.evaluate(async ({ BrowserWindow }) => {
              const worker = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'documd://export/export.html');
              return worker ? worker.webContents.executeJavaScript('window.__held === true').catch(() => false) : false;
            });
            if (!held) await page.waitForTimeout(25);
          }
          assert.equal(held, true, 'export must actually be running in its hidden host');
          if (action === 'cancel') await cancelExport(page);
          else await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .find(w => w.webContents.getURL() === 'documd://export/export.html').webContents.forcefullyCrashRenderer());
          await waitFor(page, 'document.querySelector("#cancel-export").disabled');
          assert.match(await page.locator('#status').innerText(), action === 'cancel' ? /已取消/ : /操作失败/);
          assert.equal(await fs.readFile(output, 'utf8'), 'previous output');
          assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .some(w => w.webContents.getURL() === 'documd://export/export.html')), false);
        }
      } finally {
        await electron.evaluate(({ app }) => { app.removeListener('web-contents-created', globalThis.__holdExport); delete globalThis.__holdExport; });
      }
      await exportFile(page, 'docx');
      await waitFor(page, 'document.querySelector("#cancel-export").disabled');
      assert.match(await page.locator('#status').innerText(), /已保存/);
      assert.equal((await fs.readFile(output)).subarray(0, 2).toString(), 'PK');
      assert.equal((await fs.readdir(artifacts)).some(name => name.endsWith('.tmp')), false);
    });

    await t.test('canceling dialogs preserves the current preview and source bytes', async () => {
      await electron.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
        dialog.showSaveDialog = async () => ({ canceled: true });
      });
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.equal(await page.locator('#markdown-content h1').innerText(), '桌面原型验证');
      await exportFile(page, 'pdf');
      await waitFor(page, 'document.querySelector("#cancel-export").disabled');
      assert.match(await page.locator('#status').innerText(), /已取消/);
      assert.equal(await fs.readFile(input, 'utf8'), source);
    });

    await t.test('refuses to overwrite the selected Markdown source', async () => {
      await electron.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, input);
      await exportFile(page, 'docx');
      await waitFor(page, 'document.querySelector("#cancel-export").disabled');
      assert.match(await page.locator('#status').innerText(), /Cannot overwrite/);
      assert.equal(await fs.readFile(input, 'utf8'), source);
    });

    await t.test('revokes old resources and disables export when a new document has a missing image', async () => {
      const broken = path.join(folder, '缺图.md');
      await fs.writeFile(broken, '# 缺失图片\n\n![missing](missing.png)');
      await electron.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, broken);
      await openFile(page);
      await waitFor(page, '!document.querySelector("#open").disabled');
      assert.match(await page.locator('#status').innerText(), /操作失败/);
      assert.equal(await page.locator('#docx').isDisabled(), true);
      assert.equal(await page.locator('#pdf').isDisabled(), true);
      assert.equal(await page.evaluate(`fetch(${JSON.stringify(originalImage)}).then(r => r.status)`), 403);
    });
    await t.test('settings persist across page reload and storage rejects arbitrary keys', async () => {
      await page.evaluate('globalThis.platform.settings.set("firstLineIndent", 3)');
      await page.reload();
      await waitFor(page, 'Boolean(window.desktopViewer && window.desktop)');
      assert.equal(await page.evaluate('globalThis.platform.settings.get("firstLineIndent")'), 3);
      assert.equal(await page.evaluate('window.desktop.state("set", {"__proto__": {bad: true}, "arbitrary": 1}).then(() => false, () => true)'), true);
    });
  } finally {
    await fs.writeFile(path.join(artifacts, 'console.log'), logs.join('\n'));
    await electron.close();
  }
});

test('reading position, settings and disk cache survive a full application restart', { timeout: 180000 }, async () => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'persistence');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const filePath = path.join(folder, '长文阅读.md');
  await fs.writeFile(filePath, '# 长文阅读\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n' + Array.from({ length: 120 }, (_, i) => `## 第 ${i + 1} 段\n\n这是用于验证阅读恢复的本地正文。\n\n`).join(''));
  const profile = path.join(folder, 'profile');
  let app;
  async function launch() {
    const packaged = process.env.MV_DESKTOP_EXECUTABLE;
    app = await launchDesktop({ executablePath: packaged || require('electron'),
      args: [`--user-data-dir=${profile}`, ...(packaged ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
    const page = await app.firstWindow();
    await waitFor(page, 'Boolean(window.desktopViewer && window.desktop)');
    await waitFor(page, 'document.querySelector("#locale").options.length > 2');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, filePath);
    await openFile(page); await waitFor(page, '!document.querySelector("#open").disabled');
    assert.match(await page.locator('#status').innerText(), /预览完成/);
    return page;
  }
  try {
    let page = await launch();
    const registered = await page.evaluate(`(async () => {
      const locales = window.desktopViewer.locales();
      for (const locale of locales) {
        const response = await fetch('documd://viewer/assets/_locales/' + locale.code + '/messages.json');
        if (!response.ok || !Object.keys(await response.json()).length) return false;
      }
      return locales.length;
    })()`);
    assert.equal(registered, 28);
    assert.equal(await page.evaluate('globalThis.platform.message.send({type:"PING"}) .then(r => r.ready)'), true);
    assert.equal(await page.evaluate('globalThis.platform.message.send({type:"EXECUTE_SHELL"}).then(() => false, () => true)'), true);
    await page.evaluate('Promise.all([globalThis.platform.settings.set("firstLineIndent", 1), globalThis.platform.settings.set("imageLayout", "left")])');
    assert.equal(await page.evaluate('globalThis.platform.settings.get("firstLineIndent")'), 1);
    assert.equal(await page.evaluate('globalThis.platform.settings.get("imageLayout")'), 'left');
    await openFile(page); await waitFor(page, '!document.querySelector("#open").disabled');
    assert.equal(await page.evaluate('document.querySelector("#markdown-content").classList.contains("image-layout-left")'), true);
    await page.evaluate('window.__serviceEvents = []; globalThis.platform.message.addListener(m => window.__serviceEvents.push(m.type)); undefined');
    await openSettings(page); await page.selectOption('#locale', 'zh_CN');
    await waitFor(page, 'document.documentElement.lang === "zh-CN" && !document.querySelector("#locale").disabled');
    assert.equal(await page.locator('#open [data-ui-text]').innerText(), '打开文件…');
    await waitFor(page, 'window.__serviceEvents.includes("SETTINGS_CHANGED")');
    assert.equal(await page.evaluate('globalThis.platform.cache.set("restart-probe", {text:"持久缓存"}, "test")'), true);
    const initialStats = await page.evaluate('globalThis.platform.cache.getStats()');
    assert.ok(initialStats.itemCount >= 2);
    assert.ok(initialStats.items.some(item => item.type === 'mermaid'));
    await page.evaluate('document.getElementById("reader").scrollTo({top:1400, behavior:"instant"})');
    await waitFor(page, 'document.getElementById("reader").scrollTop > 1300');
    const position = await page.evaluate('document.getElementById("reader").scrollTop');
    // Exercise the real window-close flush, without manually calling saveReadingState.
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).close(); });
    await closed;
    app = null;
    page = await launch();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL() === 'documd://render/render-host.html')), false,
      'reopening the unchanged document should reuse its persisted diagram result');
    assert.equal(await page.locator('#locale').inputValue(), 'zh_CN');
    assert.equal(await page.locator('#open [data-ui-text]').innerText(), '打开文件…');
    assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - position) < 3);
    assert.deepEqual(await page.evaluate('globalThis.platform.cache.get("restart-probe")'), { text: '持久缓存' });
    await openSettings(page); await page.click('#clear-cache');
    await waitFor(page, 'document.querySelector("#cache-status").textContent.includes("0 项")');
    assert.equal((await page.evaluate('globalThis.platform.cache.getStats()')).itemCount, 0);
    assert.equal(await page.evaluate('globalThis.platform.settings.get("preferredLocale")'), 'zh_CN');
    assert.equal(await page.evaluate(() => window.desktop.recent().then(items => items[0]?.filename)), '长文阅读.md');
    assert.ok(Math.abs(await page.evaluate('document.getElementById("reader").scrollTop') - position) < 3);
    const saved = await page.evaluate('globalThis.platform.fileState.get(globalThis.platform.document.documentPath) .catch(() => null)');
    // Public reading APIs accept stable document IDs; arbitrary filesystem strings are denied.
    assert.equal(saved, null);
  } finally { if (app) await app.close(); }
});
