import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { launchDesktop, openFile, openSettings, closeDialogs, exportFile } from './ui-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(new URL('../package.json', import.meta.url));
const schema = JSON.parse(await fs.readFile(path.join(root, 'settings-schema.json'), 'utf8'));
const registry = JSON.parse(await fs.readFile(path.join(root, 'src/themes/registry.json'), 'utf8'));

test('shared desktop settings persist, render registered themes and bind exports to their starting settings', { timeout: 180000 }, async t => {
  const artifacts = path.join(root, 'test-results/desktop', process.env.MV_DESKTOP_EXECUTABLE ? 'packaged' : 'development', 'settings');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const source = path.join(folder, '排版验证.md');
  const markdown = '---\nproject: setting-fixture\n---\n\n# 设置验证\n\n中文段落，用于核对首行缩进。\n\n---\n\n后续段落。\n\n| 名称 | 数量 |\n|---|---|\n| 项目 | |\n';
  await fs.writeFile(source, markdown);
  let app, page;
  const errors = [];
  const launch = async () => {
    const executable = process.env.MV_DESKTOP_EXECUTABLE;
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
    await page.waitForFunction(() => Boolean(window.desktopShell) && !document.getElementById('open').disabled);
  };
  const apply = async () => {
    await page.click('#settings-apply');
    await page.waitForFunction(() => !document.getElementById('settings-apply').disabled
      && document.getElementById('settings-status').textContent === '设置已保存。');
  };
  try {
    await launch();
    await t.test('all shared settings have controls and sidebar changes work before opening a document', async () => {
      await openSettings(page);
      const keys = await page.locator('[data-setting-key]').evaluateAll(fields => fields.map(field => field.dataset.settingKey));
      assert.deepEqual([...keys, 'preferredLocale'].sort(), schema.settings.filter(rule => !rule.cliOnly).map(rule => rule.key).sort());
      assert.deepEqual((await page.locator('#setting-themeId option').evaluateAll(options => options.map(option => option.value))).sort(), registry.themes.map(theme => theme.id).sort());
      await page.fill('#setting-readerSidebarWidth', '320');
      await page.check('#setting-swapPanelSide');
      await apply();
      await closeDialogs(page);
      const geometry = await page.evaluate(() => ({
        side: document.getElementById('desktop-app').dataset.sidebarSide,
        width: document.getElementById('sidebar').getBoundingClientRect().width,
        sidebar: document.getElementById('sidebar').getBoundingClientRect().left,
        document: document.getElementById('document-shell').getBoundingClientRect().right,
      }));
      assert.equal(geometry.side, 'right');
      assert.equal(geometry.width, 320);
      assert.ok(geometry.sidebar >= geometry.document);
      await app.close();
      await launch();
      assert.equal(await page.locator('#desktop-app').getAttribute('data-sidebar-side'), 'right');
      assert.equal(await page.locator('#sidebar').evaluate(node => node.getBoundingClientRect().width), 320);
    });
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    }, source);
    await openFile(page);
    await page.waitForFunction(() => document.querySelector('#markdown-content h1')?.textContent === '设置验证'
      && !document.getElementById('open').disabled);

    await t.test('every bundled theme renders through the settings UI without changing application appearance', async () => {
      const shell = await page.locator('#app-header').evaluate(node => getComputedStyle(node).backgroundColor);
      await openSettings(page);
      for (const theme of registry.themes) {
        await page.selectOption('#setting-themeId', theme.id);
        await apply();
        assert.equal(await page.evaluate(() => window.desktopApp.state().preview.current), true, theme.id);
        assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), [], theme.id);
        assert.equal(await page.locator('#app-header').evaluate(node => getComputedStyle(node).backgroundColor), shell, theme.id);
      }
      await page.selectOption('#setting-themeId', 'default');
      await page.selectOption('#setting-frontmatterDisplay', 'table');
      await page.selectOption('#setting-tableLayout', 'left');
      await page.selectOption('#setting-imageLayout', 'left');
      await page.selectOption('#setting-diagramLayout', 'left');
      await page.uncheck('#setting-tableMergeEmpty');
      await page.fill('#setting-firstLineIndent', '3');
      await page.selectOption('#setting-docxHrDisplay', 'pageBreak');
      await page.selectOption('#setting-docxEmojiStyle', 'windows');
      await apply();
      await closeDialogs(page);
      assert.match(await page.locator('#markdown-content').innerText(), /setting-fixture/);
      assert.equal(await page.locator('#markdown-content').evaluate(node => node.classList.contains('table-layout-left')), true);
      const indentation = await page.locator('#markdown-content p').filter({ hasText: '中文段落' }).evaluate(node => {
        const style = getComputedStyle(node);
        return parseFloat(style.textIndent) / parseFloat(style.fontSize);
      });
      assert.equal(indentation, 3);
      await page.screenshot({ path: path.join(artifacts, 'reading-settings.png'), scale: 'css' });
    });

    await t.test('invalid batches preserve stored values and serialized writes retain simultaneous locale changes', async () => {
      const before = await page.evaluate(() => window.platform.settings.getAll());
      assert.equal(await page.evaluate(() => window.desktopViewer.saveSettings({ tableLayout: 'center', readerSidebarWidth: 900 }).then(() => false, () => true)), true);
      assert.equal(await page.evaluate(() => window.desktopViewer.saveSettings({ themeId: 'missing-theme' }).then(() => false, () => true)), true);
      assert.deepEqual(await page.evaluate(() => window.platform.settings.getAll()), before);
      await page.evaluate(() => Promise.all([
        window.platform.settings.set('preferredLocale', 'zh_CN'),
        window.desktopViewer.saveSettings({ docxEmojiStyle: 'system' }),
      ]));
      const after = await page.evaluate(() => window.platform.settings.getAll());
      assert.equal(after.preferredLocale, 'zh_CN');
      assert.equal(after.docxEmojiStyle, 'system');
    });

    await t.test('an active Word export retains the original pagination setting while later settings are applied', async () => {
      const destination = path.join(folder, '原始设置.docx');
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = () => new Promise(resolve => { globalThis.finishSettingsExport = resolve; });
      });
      await exportFile(page, 'docx');
      await page.waitForFunction(() => window.desktopApp.state().exporting);
      await openSettings(page);
      await page.selectOption('#setting-docxHrDisplay', 'hide');
      await apply();
      await app.evaluate(async (_electron, destination) => {
        if (!globalThis.finishSettingsExport) throw Error('Export save dialog was not reached');
        globalThis.finishSettingsExport({ canceled: false, filePath: destination });
        delete globalThis.finishSettingsExport;
      }, destination);
      await page.waitForFunction(() => !window.desktopApp.state().exporting);
      const entries = unzipSync(await fs.readFile(destination));
      assert.match(strFromU8(entries['word/document.xml']), /<w:pageBreakBefore\s*\/>/);
      assert.equal((await page.evaluate(() => window.platform.settings.getAll())).docxHrDisplay, 'hide');
      await closeDialogs(page);
    });

    await t.test('settings survive a real restart and resetting defaults requires application before writing', async () => {
      await app.close();
      await launch();
      assert.match(await page.locator('#markdown-content').innerText(), /setting-fixture/);
      await openSettings(page);
      assert.equal(await page.locator('#setting-firstLineIndent').inputValue(), '3');
      assert.equal(await page.locator('#setting-docxHrDisplay').inputValue(), 'hide');
      assert.equal(await page.locator('#setting-swapPanelSide').isChecked(), true);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html')).setContentSize(960, 640);
      });
      await page.screenshot({ path: path.join(artifacts, 'settings-960.png'), scale: 'css' });
      const action = await page.locator('#settings-apply').boundingBox();
      assert.ok(action && action.x >= 0 && action.y >= 0 && action.x + action.width <= 960 && action.y + action.height <= 640);
      await page.click('#settings-reset');
      assert.equal((await page.evaluate(() => window.platform.settings.getAll())).firstLineIndent, 3);
      await apply();
      const defaults = await page.evaluate(() => window.platform.settings.getAll());
      for (const rule of schema.settings.filter(rule => !rule.cliOnly && rule.key !== 'preferredLocale')) {
        assert.equal(defaults[rule.key], rule.default, rule.key);
      }
      assert.equal(defaults.preferredLocale, 'zh_CN');
      assert.equal(await fs.readFile(source, 'utf8'), markdown);
      assert.deepEqual(errors, []);
    });
  } finally {
    if (app) {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); }).catch(() => {});
      await app.close();
    }
  }
});
