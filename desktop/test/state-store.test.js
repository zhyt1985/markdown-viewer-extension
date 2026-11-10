import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createStateStore } from '../src/state-store.cjs';

test('state writes survive reopening and concurrent updates without losing values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-state-'));
  try {
    const store = createStateStore(directory);
    await Promise.all([store.update('set', { a: 1 }), store.update('set', { b: 2 })]);
    assert.deepEqual(await createStateStore(directory).get(['a', 'b']), { a: 1, b: 2 });
    await store.update('remove', ['a']);
    assert.deepEqual(await store.get(['a', 'b']), { b: 2 });
    await fs.writeFile(path.join(directory, 'desktop-state.json'), '{damaged');
    await assert.rejects(store.update('set', { b: 3 }));
    assert.equal(await fs.readFile(path.join(directory, 'desktop-state.json'), 'utf8'), '{damaged');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
