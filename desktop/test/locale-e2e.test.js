import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { launchDesktop, openFile, openSettings, closeDialogs } from './ui-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));

test('desktop locale follows the system, switches live and persists across a restart', { timeout: 90000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'locale');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const filename = '中文文档.md';
  const source = path.join(folder, filename);
  await fs.writeFile(source, '# 正文标题\n\n保留文档原文。\n');
  const errors = [];
  let app, page;
  const ready = () => page.waitForFunction(() => !document.getElementById('open').disabled);
  async function launch() {
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: ['--lang=en-US', `--user-data-dir=${path.join(folder, 'profile')}`,
        ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      dialog.showMessageBox = async (_window, options) => {
        globalThis.localeDialog = options;
        return { response: options.buttons.length === 3 ? 1 : 0 };
      };
    }, source);
    await ready();
  }
  async function selectLocale(value, language) {
    await page.selectOption('#locale', value);
    await page.waitForFunction(language => document.documentElement.lang === language
      && !document.getElementById('locale').disabled, language);
  }
  const openLabel = () => page.locator('#open [data-ui-text]').textContent();
  const confirmClose = async () => {
    await page.locator('.tab-close').click();
    await ready();
    return app.evaluate(() => globalThis.localeDialog);
  };
  try {
    await launch();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await openLabel(), 'Open file…');
    assert.equal(await page.locator('#open kbd').textContent(), 'Ctrl O');
    await openSettings(page);
    assert.equal(await page.locator('#locale').inputValue(), 'auto');
    assert.equal(await page.locator('#locale').getAttribute('aria-label'), 'Language');
    assert.equal(await page.locator('#settings-title').textContent(), 'Settings');
    await page.screenshot({ path: path.join(artifacts, 'settings-en.png'), scale: 'css' });

    await openFile(page);
    await page.waitForFunction(() => window.desktopApp.state().preview.current);
    assert.equal(await page.locator('#markdown-content h1').textContent(), '正文标题');
    assert.equal(await page.locator('#filename').textContent(), filename);
    await page.locator('[data-shell-mode="split"]').click();
    const editor = page.locator('#markdown-editor');
    assert.equal(await editor.getAttribute('aria-label'), 'Markdown source');
    await page.locator('[data-editor-command="search"]').click();
    assert.equal(await page.locator('.cm-search input[name="search"]').getAttribute('placeholder'), 'Find');
    await page.locator('.cm-search button[name="close"]').click();
    await editor.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n\n语言切换保留编辑。');
    await page.waitForFunction(() => window.desktopApp.state().dirty && window.desktopApp.state().preview.current);
    const draft = await page.evaluate(() => window.desktopCodeEditor.value);
    assert.equal((await confirmClose()).title, 'Unsaved changes');

    await openSettings(page);
    await selectLocale('zh_CN', 'zh-CN');
    assert.equal(await openLabel(), '打开文件…');
    assert.equal(await editor.getAttribute('aria-label'), 'Markdown 源码');
    assert.equal(await page.evaluate(() => window.desktopCodeEditor.value), draft);
    assert.equal(await page.evaluate(() => window.desktopCodeEditor.canUndo), true);
    assert.equal(await page.locator('#filename').textContent(), filename);
    await closeDialogs(page);
    assert.deepEqual((await confirmClose()).buttons, ['取消', '放弃修改']);

    await openSettings(page);
    await selectLocale('de', 'de');
    assert.equal(await page.locator('#locale').getAttribute('aria-label'), 'Sprache');
    assert.equal(await page.locator('#settings-title').textContent(), 'Settings');
    await closeDialogs(page);
    await app.close();

    await launch();
    await page.waitForFunction(() => window.desktopApp.state().preview.current);
    assert.equal(await page.locator('html').getAttribute('lang'), 'de');
    assert.equal(await page.evaluate(() => window.desktopCodeEditor.value), draft);
    assert.match(await fs.readFile(source, 'utf8'), /^# 正文标题\n\n保留文档原文。\n$/);
    await openSettings(page);
    assert.equal(await page.locator('#locale').inputValue(), 'de');
    await selectLocale('auto', 'en');
    assert.equal(await openLabel(), 'Open file…');
    await t.test('every registered language can be activated from Settings', async () => {
      const locales = await page.evaluate(() => window.desktopViewer.locales());
      assert.equal(locales.length, 28);
      for (const { code } of locales) {
        await selectLocale(code, code.replace('_', '-'));
        assert.equal(await page.locator('#locale').inputValue(), code);
        assert.equal(await page.evaluate(() => window.platform.i18n.getUILanguage()), code);
      }
      await selectLocale('auto', 'en');
    });
    assert.deepEqual(errors, []);
  } finally {
    await app?.close().catch(() => {});
  }
});
