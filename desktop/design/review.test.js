import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { _electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

test('design R0.1: inspectable offline interface, interactions and window layouts', { timeout: 180000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-design-review-'));
  const previews = path.join(here, 'previews'); await fs.mkdir(previews, { recursive: true });
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [`--user-data-dir=${profile}`, '--force-device-scale-factor=1', path.join(here, 'preview.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  const errors = [];
  const contrastChecks = [];
  let passed = 0;
  const review = (name, run) => t.test(name, async () => { await run(); passed++; });
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.documentElement.dataset.designReady === 'true');
    async function resize(width, height) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height });
    }
    async function scene(name) { await page.selectOption('#review-scene', name); await page.waitForTimeout(50); }
    async function screenshot(name, device = false) {
      await page.evaluate(() => { document.getElementById('toast').hidden = true; });
      if (device) {
        // Native capture avoids CDP's clipped capture region at Electron page zoom.
        const png = await app.evaluate(async ({ BrowserWindow }) => {
          const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
          return image.toPNG().toString('base64');
        });
        await fs.writeFile(path.join(previews, `${name}.png`), Buffer.from(png, 'base64'));
      } else await page.screenshot({ path: path.join(previews, `${name}.png`), scale: 'css' });
    }
    async function fit() {
      const result = await page.evaluate(() => {
        const app = document.getElementById('app'), toolbar = document.getElementById('document-toolbar');
        const rect = app.getBoundingClientRect(); const buttons = [...toolbar.querySelectorAll('button')].filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height);
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
          layout: [...toolbar.children].map(node => ({ class: node.className, left: node.getBoundingClientRect().left, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, flex: getComputedStyle(node).flex })),
          appRight: rect.right, buttons: buttons.map(node => ({ name: node.getAttribute('aria-label') || node.textContent.trim(), left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })) };
      });
      assert.equal(result.overflow, false, `horizontal overflow at ${result.width}`);
      for (const button of result.buttons) assert.ok(button.left >= 0 && button.right <= result.appRight + 1, `toolbar clipped at ${result.width}: ${button.name}; ${JSON.stringify(result)}`);
    }
    await resize(1440, 900);
    await review('reading composition and keyboard tab navigation preserve visible focus', async () => {
      assert.equal(await page.locator('#document-article h1').innerText(), '项目说明');
      assert.equal(await page.locator('#inspector').isVisible(), true);
      await fit(); await screenshot('01-reading-light');
      await page.locator('#tab-guide').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tab-notes').getAttribute('aria-selected'), 'true');
      assert.equal(await page.evaluate('document.activeElement.id'), 'tab-notes');
      await page.keyboard.press('Control+w');
      assert.equal(await page.evaluate('document.activeElement.id'), 'tab-guide');
      await page.locator('[data-section="3"]').first().click();
      await page.waitForFunction(() => document.getElementById('reader').scrollTop > 100);
      await page.keyboard.press('Control+k'); await page.fill('#quick-input', '设计笔记');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate('document.activeElement.hasAttribute("data-quick-file")'), true);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#document-article h1').innerText(), '设计笔记');
      assert.equal(await page.evaluate('document.activeElement.id'), 'reader');
    });
    await review('split editing previews text, marks dirty and canceling close retains the draft', async () => {
      await scene('editing');
      await page.fill('#source-editor', '# 交互设计审阅\n\n这是保留在样稿内的编辑内容。\n\n## 细节\n\n查看分栏预览。');
      await page.waitForFunction(() => document.querySelector('#document-article h1').textContent === '交互设计审阅');
      assert.equal(await page.locator('.dirty-indicator').count(), 1);
      await page.click('[data-menu="workspace"]'); await page.click('[data-action="close-workspace"]');
      assert.match(await page.locator('#modal-title').innerText(), /未保存/);
      await page.click('[data-modal-action="cancel"]');
      assert.match(await page.locator('#source-editor').inputValue(), /交互设计审阅/);
      await page.locator('[data-close-tab="guide"]').click();
      assert.equal(await page.locator('#modal').isVisible(), true);
      assert.equal(await page.evaluate('document.activeElement.dataset.modalAction'), 'cancel');
      await page.keyboard.press('Escape');
      assert.match(await page.locator('#source-editor').inputValue(), /交互设计审阅/);
      await page.click('#save-button'); assert.equal(await page.locator('.dirty-indicator').count(), 0);
      await scene('editing'); await screenshot('02-split-editing'); await fit();
    });
    await review('search can be canceled, shows empty results and jumps to a matched block', async () => {
      await scene('search'); await page.click('#search-cancel'); await page.waitForTimeout(800);
      assert.match(await page.locator('#search-status').innerText(), /已取消/);
      assert.equal(await page.locator('.search-result').count(), 0);
      await page.fill('#search-input', '没有这一段内容'); await page.click('#search-start');
      await page.waitForFunction(() => document.getElementById('search-start').disabled === false);
      assert.match(await page.locator('#search-results').innerText(), /没有找到/);
      await page.fill('#search-input', '导出'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.search-result').length > 0);
      await page.locator('.search-result').first().click();
      assert.equal(await page.locator('.search-hit').count(), 1); await screenshot('03-search');
    });
    await review('annotations can be added, deleted and restored with a visible undo action', async () => {
      await scene('annotations');
      await page.click('[data-action="add-annotation"]'); await page.fill('#annotation-text', '确认这里的交互是否符合个人使用习惯。');
      await page.click('[data-modal-action="save"]'); assert.equal(await page.locator('.annotation-card').count(), 3);
      await page.locator('[data-delete-note]').first().click(); assert.equal(await page.locator('.annotation-card').count(), 2);
      await page.click('[data-action="undo-annotation"]'); assert.equal(await page.locator('.annotation-card').count(), 3);
      await screenshot('04-annotations');
    });
    await review('export modal traps focus, returns focus and exposes a cancelable task', async () => {
      await scene('reading'); await page.click('.export-trigger');
      assert.equal(await page.locator('#modal-title').innerText(), '导出当前文档');
      await screenshot('05-export-dialog');
      for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate('document.getElementById("modal").contains(document.activeElement)'), true); }
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate('document.activeElement.classList.contains("export-trigger")'), true);
      await page.click('.export-trigger'); await page.click('[data-modal-action="export"]');
      await page.click('[data-action="tasks"]'); await page.locator('[data-cancel-task]').click();
      assert.match(await page.locator('[data-tasks]').innerText(), /已取消/);
      await page.keyboard.press('Escape');
    });
    await review('conflict review preserves edits on cancel and offers a separate copy', async () => {
      await scene('conflict'); const draft = await page.locator('#source-editor').inputValue();
      assert.equal(await page.locator('#conflict-banner').isVisible(), true);
      await screenshot('06-conflict-banner');
      await page.click('[data-action="compare"]'); await screenshot('07-conflict-comparison');
      await page.click('[data-modal-action="reload"]'); await page.click('[data-modal-action="cancel"]');
      assert.equal(await page.locator('#source-editor').inputValue(), draft);
      await page.click('[data-action="save-copy"]'); await page.fill('#copy-name', '我的编辑副本.md'); await page.click('[data-modal-action="save"]');
      assert.match(await page.locator('.tab-label[aria-selected="true"]').innerText(), /我的编辑副本/);
      assert.equal(await page.locator('#conflict-banner').isVisible(), false);
    });
    await review('settings and independent document appearance support both light and dark review', async () => {
      await scene('reading'); await page.click('.header-actions [data-action="settings"]');
      await page.selectOption('#theme-select', 'dark'); assert.equal(await page.locator('body').getAttribute('class'), 'dark');
      await screenshot('08-settings-dark'); await page.keyboard.press('Escape');
      await screenshot('09-reading-dark');
      await page.click('.header-actions [data-action="appearance"]');
      await page.locator('[data-action="document-style"]').first().click(); await page.selectOption('#paper-theme', 'warm');
      assert.equal(await page.locator('#document-article').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(252, 248, 238)');
      await page.keyboard.press('Escape');
      async function contrast() { return page.evaluate(() => {
        function rgb(value) { return value.match(/[\d.]+/g).slice(0, 3).map(Number).map(number => { const c = number / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); }
        function luminance(value) { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; }
        const pairs = [['.side-caption', '.sidebar'], ['.export-trigger', '.export-trigger'], ['#document-article', '#document-article']];
        return pairs.map(([textSelector, backgroundSelector]) => { const text = luminance(getComputedStyle(document.querySelector(textSelector)).color), bg = luminance(getComputedStyle(document.querySelector(backgroundSelector)).backgroundColor); return (Math.max(text, bg) + .05) / (Math.min(text, bg) + .05); });
      }); }
      const light = await contrast(); contrastChecks.push({ appearance: 'light with warm document', ratios: light });
      light.forEach(value => assert.ok(value >= 4.5, `light text contrast ${value}`));
      await page.click('.header-actions [data-action="appearance"]');
      await scene('reading');
      const dark = await contrast(); contrastChecks.push({ appearance: 'dark', ratios: dark });
      dark.forEach(value => assert.ok(value >= 4.5, `dark text contrast ${value}`));
      await page.click('.header-actions [data-action="appearance"]');
    });
    await review('empty state provides visible local entry points and no hidden destructive navigation', async () => {
      await scene('editing'); await page.fill('#source-editor', '# 尚未保存的笔记\n\n需要保留。');
      await page.click('.brand'); assert.equal(await page.locator('.welcome h1').innerText(), '从一份本地文档开始');
      await page.locator('#tab-guide').click(); assert.match(await page.locator('#source-editor').inputValue(), /尚未保存/);
      await scene('empty'); await screenshot('10-welcome');
      assert.equal(await page.locator('.welcome [data-action="open-file"]').isVisible(), true);
      await page.locator('.welcome [data-action="open-folder"]').click(); await page.click('[data-open-workspace]');
      assert.equal(await page.locator('#document-article h1').innerText(), '项目说明');
    });
    await review('layouts fit laptop, minimum and magnified windows without clipped primary controls', async () => {
      await scene('reading');
      for (const [width, height] of [[1280, 800], [1024, 768], [960, 640], [640, 720], [360, 720]]) {
        await resize(width, height); await fit();
        if (width < 1280) assert.equal(await page.locator('#inspector').isVisible(), false, 'resizing must not automatically cover document text');
        if (width === 960 || width === 360) await screenshot(`11-reading-${width}`);
      }
      await resize(1280, 800);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
      await page.waitForFunction(() => innerWidth === 640); await fit(); await screenshot('12-zoom-200', true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(previews, 'review-results.json'), JSON.stringify({ revision: 'R0.1', date: '2026-11-05',
      scope: 'design mockup only; no native document IO', testedWindowSizes: ['1440x900', '1280x800', '1024x768', '960x640', '640x720', '360x720', '1280x800 at 200% zoom'],
      pageErrors: errors, contrastChecks, checksPassed: passed, checksExpected: 9,
      status: passed === 9 ? 'automated design checks passed; human review pending' : 'design checks failed; see test output' }, null, 2) + '\n');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
});
