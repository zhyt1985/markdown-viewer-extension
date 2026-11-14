// Performance sample, run against a real packaged desktop executable outside the functional suite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchDesktop, openWorkspace, selectNav } from './ui-helpers.js';

const executablePath = process.env.MV_DESKTOP_EXECUTABLE;
if (!executablePath) throw Error('Set MV_DESKTOP_EXECUTABLE to a packaged desktop executable');
const runs = Number(process.env.MV_DESKTOP_PERF_SAMPLES ?? 5);
assert.ok(Number.isInteger(runs) && runs >= 5 && runs <= 20);
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'documd-p6-search-')));
const nested = path.join(temp, 'nested');
const flat = path.join(temp, 'flat');
const marker = 'workspace-needle-Q7';
const data = { environment: { platform: os.platform(), arch: os.arch(), kernel: os.release(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() },
  fixture: { directories: 100, markdownFiles: 10000, matches: 100 }, rounds: [] };

async function makeFixture() {
  await fs.mkdir(nested);
  await fs.mkdir(flat);
  for (let group = 0; group < 100; group++) {
    const prefix = String(group).padStart(3, '0');
    const folder = path.join(nested, prefix);
    await fs.mkdir(folder);
    await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const matched = index === 99;
      const name = `doc-${prefix}-${String(index).padStart(2, '0')}${matched ? '-marker' : ''}.md`;
      const source = path.join(folder, name);
      await fs.writeFile(source, `# Document ${group}-${index}\n\n${matched ? marker : 'Ordinary local paragraph.'}\n`);
      await fs.link(source, path.join(flat, name));
    }));
  }
}

async function start(profile) {
  const app = await launchDesktop({ executablePath, args: [`--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    return { app, page };
  } catch (error) { await app.close(); throw error; }
}

async function observeClick(page, selector, finished) {
  await page.evaluate(({ selector, finished }) => {
    const target = document.querySelector(selector);
    const probe = window.__workspaceTime = { clickAt: null, finishAt: null, statuses: [] };
    const status = document.getElementById('search-status');
    target.addEventListener('click', () => {
      probe.clickAt = performance.timeOrigin + performance.now();
      const updates = new MutationObserver(() => {
        const text = status.textContent;
        if (text && text !== probe.statuses.at(-1)) probe.statuses.push(text);
      });
      updates.observe(status, { childList: true, characterData: true, subtree: true });
      const frame = () => {
        const complete = finished === 'tree' ? !window.desktopApp.state().busy
          : document.getElementById('search-cancel').disabled && Boolean(status.textContent);
        if (complete) { probe.finishAt = performance.timeOrigin + performance.now(); updates.disconnect(); }
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  }, { selector, finished });
}
async function timing(page) {
  await page.waitForFunction(() => Number.isFinite(window.__workspaceTime?.finishAt));
  return page.evaluate(() => window.__workspaceTime);
}

async function choose(app, page, folder) {
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, folder);
  await observeClick(page, '#open-workspace', 'tree');
  await openWorkspace(page);
  const t = await timing(page);
  return t.finishAt - t.clickAt;
}
async function search(page, query, mode, cancel = false) {
  await page.selectOption('#search-mode', mode);
  await page.fill('#search-query', query);
  if (!cancel) await observeClick(page, '#search-start', 'search');
  await page.click('#search-start');
  if (cancel) return;
  const t = await timing(page);
  const status = await page.locator('#search-status').textContent();
  const results = await page.locator('.search-result').allTextContents();
  return { elapsedMs: t.finishAt - t.clickAt, status, progress: t.statuses.filter(s => s.startsWith('正在检索') && /\d/.test(s)).length,
    matches: results.length, sample: results[0] };
}

async function measureCancel(app, page) {
  await app.evaluate((_electron, root) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const original = fs.opendir;
    const probe = globalThis.__workspaceCancel = { opened: 0, closed: 0 };
    globalThis.__restoreWorkspaceProbe = () => { fs.opendir = original; };
    fs.opendir = async function (folder, ...args) {
      const handle = await original.call(this, folder, ...args);
      if (folder === root || folder.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
        const close = handle.close.bind(handle);
        probe.opened++;
        handle.close = async (...args) => {
          try { return await close(...args); }
          finally { probe.closed++; probe.closedAt = performance.timeOrigin + performance.now(); }
        };
      }
      return handle;
    };
  }, nested);
  try {
    await search(page, 'not-present-in-any-file', 'content', true);
    const started = performance.now();
    while (!await app.evaluate(() => globalThis.__workspaceCancel.opened > globalThis.__workspaceCancel.closed)) {
      if (performance.now() - started > 2000) throw Error('search did not start a directory scan');
      await delay(5);
    }
    await observeClick(page, '#search-cancel', 'search');
    await page.click('#search-cancel');
    const ui = await timing(page);
    assert.equal(await page.locator('#search-status').textContent(), '已取消检索');
    assert.equal(await page.locator('.search-result').count(), 0);
    let backend;
    const deadline = performance.now() + 2000;
    do {
      backend = await app.evaluate(() => globalThis.__workspaceCancel);
      if (backend.opened === backend.closed && backend.closedAt >= ui.clickAt) break;
      await delay(10);
    } while (performance.now() < deadline);
    assert.equal(backend.opened, backend.closed, 'the directory scan did not release its handles');
    assert.ok(backend.closedAt >= ui.clickAt, 'directory closed before the cancellation click');
    return { uiMs: ui.finishAt - ui.clickAt, directoryReleasedMs: backend.closedAt - ui.clickAt,
      openedDirectories: backend.opened };
  } finally { await app.evaluate(() => globalThis.__restoreWorkspaceProbe()); }
}

try {
  await makeFixture();
  for (let i = 1; i <= runs; i++) {
    const { app, page } = await start(path.join(temp, `profile-${i}`));
    try {
      if (!data.environment.version) Object.assign(data.environment, await app.evaluate(({ app }) => ({
        version: app.getVersion(), electron: process.versions.electron,
      })));
      const rootListMs = await choose(app, page, nested);
      assert.equal(await page.locator('#workspaces .tree-dir').count(), 100);
      const dir = page.locator('.tree-dir[data-name="000"]');
      await observeClick(page, '.tree-dir[data-name="000"]', 'tree');
      await dir.click();
      const t = await timing(page);
      assert.equal(await page.locator('#workspaces .tree-file').count(), 100);
      await selectNav(page, 'search');
      const filename = await search(page, '-marker.md', 'filename');
      const content = await search(page, marker, 'content');
      const cancel = await measureCancel(app, page);
      data.rounds.push({ i, rootListMs, leafListMs: t.finishAt - t.clickAt, filename, content, cancel });
      console.error(`completed workspace trial ${i}/${runs}`);
    } finally { await app.close(); }
  }

  const { app, page } = await start(path.join(temp, 'flat-profile'));
  try {
    const rootListMs = await choose(app, page, flat);
    const initial = await page.locator('#workspaces .tree-file').count();
    const next = page.locator('#workspaces .tree-page-next');
    const ids = () => page.locator('#workspaces .tree-file').evaluateAll(nodes => nodes.map(node => node.dataset.entryId));
    const seen = new Set(await ids());
    let largestPage = initial;
    const pages = [];
    while (await next.count()) {
      await observeClick(page, '#workspaces .tree-page-next', 'tree');
      await next.click();
      const t = await timing(page);
      const current = await ids();
      largestPage = Math.max(largestPage, current.length);
      assert.ok(current.length > 0 && current.every(id => !seen.has(id)), 'next page repeated an entry');
      for (const id of current) seen.add(id);
      pages.push(t.finishAt - t.clickAt);
    }
    if (pages.length) {
      const lastPage = await ids();
      await page.locator('#workspaces .tree-page-previous').click();
      await page.waitForFunction(() => !window.desktopApp.state().busy);
      assert.notDeepEqual(await ids(), lastPage);
      await next.click();
      await page.waitForFunction(() => !window.desktopApp.state().busy);
      assert.deepEqual(await ids(), lastPage);
    }
    let openedLast;
    if (seen.size) {
      const last = page.locator('#workspaces .tree-file').last();
      openedLast = await last.getAttribute('data-name');
      await last.click();
      await page.waitForFunction(name => !window.desktopApp.state().busy && window.desktopApp.state().document?.filename === name, openedLast);
    }
    data.flat = { rootListMs, initial, distinct: seen.size, largestPage, pages, openedLast, status: await page.locator('#status').textContent() };
  } finally { await app.close(); }
  console.log(JSON.stringify(data, null, 2));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
