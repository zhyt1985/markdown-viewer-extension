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
    await state.update('set', { desktopRecent: { version: 1, items: [] } });
    assert.equal((await history.load()).documents.length, 0);
    assert.deepEqual(history.listWorkspaces([]), []);
    for (let i = 0; i < 25; i++) history.touch({ source: path.join(temporary, `${i}.md`), resourceRoot: temporary });
    assert.equal(history.list().length, 20);
    const id = history.list()[0].id; assert.equal(history.resolve(id).source, path.join(temporary, '24.md'));
    await assert.rejects(async () => history.resolve('../secret'));
    const session = { workspaces: [temporary], documents: [history.resolve(id)], activeSource: path.join(temporary, '24.md') };
    for (let i = 0; i < 25; i++) history.touchWorkspace(path.join(temporary, String(i)));
    history.touchWorkspace(path.join(temporary, '23'));
    assert.equal(history.listWorkspaces([]).length, 20);
    const [workspace] = history.listWorkspaces([]);
    assert.equal(workspace.name, '23');
    assert.equal(history.resolveWorkspace(workspace.id, [workspace.root]), undefined);
    await history.save(session);
    const restarted = createNavigationHistory(createStateStore(temporary));
    assert.deepEqual(await restarted.load(), { version: 1, ...session }); assert.deepEqual(restarted.list(), history.list());
    assert.equal(restarted.resolveWorkspace(workspace.id, []), workspace.root);
    restarted.clear(); await restarted.save(session);
    assert.deepEqual((await state.get(['desktopRecent'])).desktopRecent.items, []);
    assert.deepEqual((await state.get(['desktopRecent'])).desktopRecent.workspaces, []);
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
    assert.equal((await search('missing', 'filename', { files: 0 })).truncated, true);
    await assert.rejects(search('', 'content'), /Invalid/);
    await fs.rename(folder, path.join(temporary, 'old-root'));
    await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(search('needle', 'content'), /replaced/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('workspace tree pages preserve sorted names and scoped file identities', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-tree-pages-'));
  try {
    await fs.mkdir(path.join(temporary, 'nested'));
    for (let batch = 0; batch < 5; batch++) {
      await Promise.all(Array.from({ length: 101 }, (_, i) =>
        fs.writeFile(path.join(temporary, `File-${String(batch * 101 + i).padStart(3, '0')}.md`), '# Local')));
    }
    const workspaces = createWorkspaces();
    const { id } = await workspaces.add(temporary);
    const first = await workspaces.list(id);
    const second = await workspaces.list(id, id, first.nextOffset);
    assert.equal(first.total, 506);
    assert.equal(first.items.length, 500);
    assert.equal(first.items[0].name, 'nested');
    assert.equal(first.previousOffset, null);
    assert.equal(second.items.length, 6);
    assert.equal(second.previousOffset, 0);
    assert.equal(second.nextOffset, null);
    const names = [...first.items, ...second.items].map(item => item.name);
    assert.deepEqual(names, ['nested', ...Array.from({ length: 505 }, (_, i) => `File-${String(i).padStart(3, '0')}.md`)]);
    const last = second.items.at(-1);
    assert.equal((await workspaces.file(id, last.id)).source, path.join(await fs.realpath(temporary), last.name));
    assert.equal((await workspaces.list(id, id, 500)).items.at(-1).id, last.id);
    await assert.rejects(workspaces.list(id, id, -1), /Invalid directory page/);
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
