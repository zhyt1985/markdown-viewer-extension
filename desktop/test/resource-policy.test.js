import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import policy from '../src/resource-policy.cjs';

test('canonical resource grants reject traversal, sibling prefixes and directory links', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-policy-'));
  try {
    const root = path.join(temporary, 'allowed');
    const sibling = path.join(temporary, 'allowed-other');
    await fs.mkdir(root);
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(root, '图片.svg'), 'inside');
    await fs.writeFile(path.join(sibling, 'secret.txt'), 'outside');
    assert.equal(await policy.within(root, path.join(root, '图片.svg')), await fs.realpath(path.join(root, '图片.svg')));
    await assert.rejects(policy.within(root, path.join(root, '../allowed-other/secret.txt')), /outside/);
    await fs.symlink(sibling, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(policy.within(root, path.join(root, 'link/secret.txt')), /outside/);
  } finally {
    // Only remove this test's freshly created temporary directory.
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
