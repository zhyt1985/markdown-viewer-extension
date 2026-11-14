import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeDialogs, launchDesktop, openFile, openSettings } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const current = process.env.MV_DESKTOP_EXECUTABLE;
const previous = process.env.MV_DESKTOP_PREVIOUS_EXECUTABLE;
const note = '备份演练批注';
const selection = '需要保留的批注锚点';
const annotatedText = `# 批注原文\n\n${selection}。\n`;
const diskText = '\uFEFF# 磁盘原文\r\n\r\n源文件不能被草稿覆盖。\r\n';
const namedDraft = '# 文件草稿\n\n只应出现在配置中。';
const untitledDraft = '# 未命名草稿\n\n独立恢复。';

const copy = (source, target) => fs.cp(source, target, {
  recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true,
});

async function profileHashes(profile) {
  const state = ['desktop-state.json'];
  for (const directory of ['annotations', 'drafts']) {
    const records = (await fs.readdir(path.join(profile, directory))).filter(name => name.endsWith('.json')).sort();
    assert.ok(records.length, `expected application records in ${directory}`);
    state.push(...records.map(name => path.join(directory, name)));
  }
  return Object.fromEntries(await Promise.all(state.map(async name => [
    name, createHash('sha256').update(await fs.readFile(path.join(profile, name))).digest('hex'),
  ])));
}

async function rehearsal(t, firstExecutable, crossVersion) {
  const artifacts = path.join(root, 'test-results/desktop', current ? 'packaged' : 'development', 'profile-backup');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const sourceRoot = path.join(folder, 'sources');
  const annotated = path.join(sourceRoot, '批注原文.md');
  const named = path.join(sourceRoot, '磁盘原文.md');
  const original = path.join(folder, 'original-profile');
  const backup = path.join(folder, 'profile-backup');
  const sourceBackup = path.join(folder, 'source-backup');
  await fs.mkdir(sourceRoot);
  await Promise.all([fs.writeFile(annotated, annotatedText), fs.writeFile(named, diskText)]);
  let app, page;

  async function start(profile, executable) {
    app = await launchDesktop({
      executablePath: executable || require('electron'),
      args: [`--user-data-dir=${profile}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy
      && !document.getElementById('open').disabled);
    await app.evaluate(({ dialog }, paths) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
    }, [annotated, named]);
    return page.evaluate(() => window.desktop.appInfo());
  }

  async function stop() {
    const exited = app.waitForEvent('close', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().endsWith('/index.html')).close());
    await exited;
    app = null;
  }

  const document = () => page.evaluate(() => window.desktopApp.state().document);
  const editor = () => page.evaluate(() => window.desktopCodeEditor.getText());

  async function readyDocument(id) {
    await page.waitForFunction(id => {
      const state = window.desktopApp.state();
      return !state.busy && state.document?.documentId === id && state.preview.current;
    }, id);
  }

  async function activate(id) {
    await page.locator(`.document-tab[data-document-id="${id}"] .tab-open`).click();
    await readyDocument(id);
  }

  async function edit(value) {
    const field = page.locator('#markdown-editor');
    if (!await field.isVisible()) await page.locator('[data-shell-mode="split"]').click();
    await field.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(value);
    await page.waitForFunction(value => window.desktopCodeEditor.getText() === value, value);
    await page.evaluate(() => window.desktopEditor.flush());
  }

  async function appearance(value) {
    await openSettings(page);
    await page.selectOption('#appearance', value);
    await page.waitForFunction(value => document.getElementById('desktop-app').dataset.appearance === value, value);
    await closeDialogs(page);
  }

  async function addNote() {
    await page.locator('#markdown-content p').evaluate((paragraph, text) => {
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, text.length);
      const active = window.getSelection();
      active.removeAllRanges();
      active.addRange(range);
      paragraph.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, selection);
    await page.locator('#annotation-note').fill(note);
    await page.locator('#annotation-add').click();
    await page.locator('#annotation-list li').filter({ hasText: note }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('#markdown-content mark[data-desktop-remark]').textContent(), selection);
  }

  async function sourceIntegrity() {
    for (const [file, text] of [[annotated, annotatedText], [named, diskText]]) {
      const bytes = await fs.readFile(file);
      assert.deepEqual(bytes, Buffer.from(text));
      assert.deepEqual(await fs.readFile(path.join(sourceBackup, path.basename(file))), bytes);
    }
  }

  let annotatedId, namedId, untitledId;
  async function checkRestored() {
    const restored = await document();
    assert.equal(restored.documentId, untitledId, 'active tab identity must survive restore');
    assert.equal(restored.untitled, true);
    assert.equal(await editor(), untitledDraft);
    const tabs = await page.evaluate(() => window.desktopApp.state().tabs.map(tab => tab.documentId));
    assert.deepEqual(new Set(tabs), new Set([annotatedId, namedId, untitledId]));
    assert.equal(await page.locator('#desktop-app').getAttribute('data-appearance'), 'dark');
    await activate(namedId);
    assert.equal(await editor(), namedDraft);
    assert.equal((await document()).recovered, true);
    await activate(annotatedId);
    assert.equal(await page.locator('#markdown-content mark[data-desktop-remark]').textContent(), selection);
    assert.match(await page.locator('#annotation-list li').textContent(), new RegExp(note));
    await sourceIntegrity();
  }

  try {
    const baseline = await start(original, firstExecutable);
    await openFile(page);
    await page.waitForFunction(() => !window.desktopApp.state().busy && window.desktopApp.state().tabs.length === 2);
    const open = await page.evaluate(() => window.desktopApp.state().tabs);
    annotatedId = open.find(tab => tab.filename === path.basename(annotated)).documentId;
    namedId = open.find(tab => tab.filename === path.basename(named)).documentId;
    await activate(annotatedId);
    await addNote();
    await activate(namedId);
    await edit(namedDraft);
    await page.click('[data-shell-action="file-menu"]');
    await page.click('#new-document');
    await page.waitForFunction(() => !window.desktopApp.state().busy && window.desktopApp.state().document?.untitled);
    untitledId = (await document()).documentId;
    await edit(untitledDraft);
    await appearance('dark');
    await stop();

    await copy(original, backup);
    await copy(sourceRoot, sourceBackup);
    const unchanged = await profileHashes(backup);
    assert.deepEqual(await profileHashes(original), unchanged);
    await sourceIntegrity();

    const restoredProfile = path.join(folder, crossVersion ? 'upgraded-profile' : 'restored-profile');
    await copy(backup, restoredProfile);
    const installed = await start(restoredProfile, current);
    if (crossVersion) {
      assert.equal(installed.appId, baseline.appId);
      const alpha = version => Number(/^0\.1\.0-alpha\.(\d+)$/.exec(version)?.[1]);
      assert.ok(alpha(installed.version) > alpha(baseline.version), `${baseline.version} → ${installed.version}`);
    } else assert.equal(installed.version, baseline.version);
    await checkRestored();

    // Change the recovered copy, then prove those writes never touched either baseline.
    await activate(untitledId);
    await edit(untitledDraft + '\n\n只写入恢复副本。');
    await appearance('light');
    await stop();
    assert.notDeepEqual(await profileHashes(restoredProfile), unchanged);
    assert.deepEqual(await profileHashes(original), unchanged);
    assert.deepEqual(await profileHashes(backup), unchanged);

    if (crossVersion) {
      const rollback = path.join(folder, 'rollback-profile');
      await copy(backup, rollback);
      const rolledBack = await start(rollback, firstExecutable);
      assert.equal(rolledBack.version, baseline.version);
      await checkRestored();
      await stop();
      assert.deepEqual(await profileHashes(backup), unchanged);
    }
    await sourceIntegrity();
    t.diagnostic(`${baseline.version} → ${installed.version}${crossVersion ? ' → ' + baseline.version : ''}`);
    t.diagnostic(`isolated profile and source copies: ${folder}`);
  } finally { if (app) await app.close(); }
}

test('a closed desktop profile restores tabs, drafts, settings and annotations from a separate backup', { timeout: 120000 },
  t => rehearsal(t, current, false));

if (previous) {
  if (!current) throw Error('Set MV_DESKTOP_EXECUTABLE alongside MV_DESKTOP_PREVIOUS_EXECUTABLE');
  test('desktop upgrades a backup copy and rolls back with the pre-upgrade backup and old executable', { timeout: 120000 },
    t => rehearsal(t, previous, true));
}
