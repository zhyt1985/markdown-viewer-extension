import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createWorkspaces } from '../src/workspaces.cjs';

test('workspace entries are scoped, deduplicated and revalidated after filesystem changes', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-workspace-'));
  try {
    const folder = path.join(temporary, 'root'); const outside = path.join(temporary, 'outside');
    await fs.mkdir(path.join(folder, 'nested'), { recursive: true }); await fs.mkdir(outside);
    await fs.writeFile(path.join(folder, 'nested', '正文.md'), '# 文件');
    await fs.writeFile(path.join(outside, 'secret.md'), '# outside');
    const store = createWorkspaces(); const workspace = await store.add(folder);
    assert.deepEqual(await store.add(folder), workspace);
    const nested = (await store.list(workspace.id)).find(item => item.name === 'nested');
    const item = (await store.list(workspace.id, nested.id))[0];
    assert.equal(item.supported, true);
    assert.equal((await store.file(workspace.id, item.id)).resourceRoot, await fs.realpath(folder));
    await assert.rejects(store.file(workspace.id, '../outside/secret.md'), /Unknown/);
    await fs.rename(path.join(folder, 'nested'), path.join(folder, 'renamed'));
    await fs.symlink(outside, path.join(folder, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.list(workspace.id, nested.id), /outside/);
    await assert.rejects(store.file(workspace.id, item.id));
    const link = (await store.list(workspace.id)).find(entry => entry.name === 'nested');
    assert.equal(link.kind, 'link'); assert.equal(link.supported, false);
    await assert.rejects(store.file(workspace.id, link.id), /regular/);
    await fs.rename(folder, path.join(temporary, 'moved-root'));
    await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.list(workspace.id), /replaced/);
    store.close(workspace.id);
    await assert.rejects(store.list(workspace.id), /closed/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
