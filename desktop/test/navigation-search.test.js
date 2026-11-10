import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createWorkspaces } from '../src/workspaces.cjs';
import { createNavigationHistory } from '../src/navigation-history.cjs';
import { createStateStore } from '../src/state-store.cjs';
import { searchWorkspace } from '../src/workspace-search.cjs';

test('navigation history persists bounded recent documents and validates saved scopes', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-history-'));
  try {
    const state = createStateStore(temporary); const history = createNavigationHistory(state);
    assert.equal((await history.load()).documents.length, 0);
    for (let i = 0; i < 25; i++) history.touch({ source: path.join(temporary, `${i}.md`), resourceRoot: temporary });
    assert.equal(history.list().length, 20);
    const id = history.list()[0].id; assert.equal(history.resolve(id).source, path.join(temporary, '24.md'));
    await assert.rejects(async () => history.resolve('../secret'));
    const session = { workspaces: [temporary], documents: [history.resolve(id)], activeSource: path.join(temporary, '24.md') };
    await history.save(session);
    const restarted = createNavigationHistory(createStateStore(temporary));
    assert.deepEqual(await restarted.load(), { version: 1, ...session }); assert.deepEqual(restarted.list(), history.list());
    restarted.clear(); await restarted.save(session);
    assert.deepEqual((await state.get(['desktopRecent'])).desktopRecent.items, []);
    await state.update('set', { desktopSession: { ...session, version: 99 } });
    await assert.rejects(createNavigationHistory(state).load(), /Invalid/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('workspace search matches nested names and source lines, skips links and enforces limits', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-search-'));
  try {
    const folder = path.join(temporary, 'root'); const outside = path.join(temporary, 'outside');
    await fs.mkdir(path.join(folder, '子目录'), { recursive: true }); await fs.mkdir(outside);
    await fs.writeFile(path.join(folder, '子目录', '搜索.md'), '# 标题\r\n\r\n正文 NEEDLE\r\n第二个 needle');
    await fs.writeFile(path.join(folder, 'ignored.bin'), 'needle');
    await fs.writeFile(path.join(outside, 'secret.md'), 'needle');
    await fs.symlink(outside, path.join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const workspaces = createWorkspaces(); const workspace = await workspaces.add(folder);
    const search = (query, mode, limits) => searchWorkspace(workspaces, workspace.id, query, mode, new AbortController().signal, limits);
    const names = await search('搜索', 'filename'); assert.equal(names.items.length, 1); assert.equal(names.skipped, 1);
    const content = await search('needle', 'content');
    assert.deepEqual(content.items.map(item => item.line), [3, 4]); assert.match(content.items[0].snippet, /NEEDLE/);
    assert.equal(content.items[0].entryId, names.items[0].entryId);
    assert.match((await workspaces.file(workspace.id, content.items[0].entryId)).source, /搜索.md$/);
    assert.equal((await search('needle', 'content', { results: 1 })).truncated, true);
    assert.equal((await search('needle', 'content', { bytes: 1 })).truncated, true);
    assert.equal((await search('needle', 'content', { entries: 1 })).truncated, true);
    await assert.rejects(search('', 'content'), /Invalid/);
    await fs.rename(folder, path.join(temporary, 'old-root'));
    await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(search('needle', 'content'), /replaced/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('an in-flight workspace scan can be canceled and returns no stale results', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-search-cancel-'));
  try {
    for (let i = 0; i < 100; i++) await fs.writeFile(path.join(temporary, `${i}.md`), 'needle\n'.repeat(100));
    const workspaces = createWorkspaces(); const workspace = await workspaces.add(temporary);
    const controller = new AbortController();
    const pending = searchWorkspace(workspaces, workspace.id, 'needle', 'content', controller.signal);
    setImmediate(() => controller.abort());
    const result = await pending; assert.equal(result.canceled, true); assert.deepEqual(result.items, []);
    assert.equal((await searchWorkspace(workspaces, workspace.id, '99', 'filename', new AbortController().signal)).items.length, 1);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
