import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createDiskCache } from '../src/disk-cache.cjs';
import { createStateStore } from '../src/state-store.cjs';
import { createAppServices } from '../src/app-services.cjs';
import schema from '../../settings-schema.json' with { type: 'json' };

test('disk cache persists, evicts, isolates versions and recovers from corruption', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-cache-'));
  try {
    const cache = createDiskCache(folder, 'v1', { maxItems: 2, maxBytes: 10000, maxEntryBytes: 1000 });
    await cache.set('a', { text: 'first' }); await cache.set('b', 'second');
    assert.deepEqual(await createDiskCache(folder, 'v1').get('a'), { text: 'first' });
    await cache.set('c', 'third');
    assert.deepEqual(await cache.get('a'), { text: 'first' });
    assert.equal(await cache.get('b'), null);
    assert.equal((await cache.stats()).itemCount, 2);
    assert.ok((await cache.stats()).totalSize > 0);
    assert.equal(await cache.set('huge', 'x'.repeat(1001)), false);
    const cacheFile = (await fs.readdir(folder)).find(file => file.endsWith('.json'));
    await fs.writeFile(path.join(folder, cacheFile), 'broken');
    await cache.stats();
    assert.equal((await cache.stats()).itemCount, 1);
    const next = createDiskCache(folder, 'v2');
    assert.equal(await next.get('a'), null);
    assert.equal((await next.stats()).itemCount, 0);
    await next.set('../../outside', 'safe key');
    assert.equal(await next.get('../../outside'), 'safe key');
    await next.clear(); assert.equal((await next.stats()).itemCount, 0);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('service envelopes enforce scope, preserve merged reading state and propagate events/errors', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-service-'));
  try {
    const id = 'a'.repeat(64);
    const events = [];
    const state = createStateStore(folder);
    const service = createAppServices(state, createDiskCache(path.join(folder, 'cache'), 'v1'), key => key === id, event => events.push(event), { schema: schema.settings, locales: ['en', 'zh_CN'] });
    let sequence = 0;
    const send = (type, payload) => service({ id: String(++sequence), type, payload });
    assert.equal((await send('STORAGE_SET', { items: { markdownViewerSettings: { themeId: 'default' } } })).ok, true);
    assert.equal(events[0].type, 'SETTINGS_CHANGED');
    await Promise.all([
      send('FILE_STATE_OPERATION', { operation: 'set', url: id, state: { scrollTop: 400 } }),
      send('FILE_STATE_OPERATION', { operation: 'set', url: id, state: { zoom: 1.5 } }),
      send('FILE_STATE_OPERATION', { operation: 'set', url: id, state: { documentMode: 'split' } }),
    ]);
    assert.deepEqual((await send('FILE_STATE_OPERATION', { operation: 'get', url: id })).data, { scrollTop: 400, zoom: 1.5, documentMode: 'split' });
    assert.equal((await send('FILE_STATE_OPERATION', { operation: 'get', url: 'b'.repeat(64) })).ok, false);
    assert.equal((await send('FILE_STATE_OPERATION', { operation: 'set', url: id, state: { scrollTop: -1 } })).ok, false);
    assert.equal((await send('FILE_STATE_OPERATION', { operation: 'set', url: id, state: { documentMode: 'invalid' } })).ok, false);
    assert.equal((await send('STORAGE_GET', { keys: ['arbitrary'] })).ok, false);
    assert.equal((await send('STORAGE_SET', { items: { markdownViewerSettings: { firstLineIndent: -10 } } })).ok, false);
    assert.equal((await send('STORAGE_SET', { items: { markdownViewerSettings: { preferredLocale: '../bad' } } })).ok, false);
    assert.equal((await send('EXECUTE_SHELL', {})).ok, false);
    assert.equal((await send('PING', {})).data.ready, true);
    await assert.rejects(service({ type: 'PING' }), /envelope/);
    await send('CACHE_OPERATION', { operation: 'set', key: 'x', value: 'cache' });
    await send('CACHE_OPERATION', { operation: 'clear' });
    assert.equal((await send('FILE_STATE_OPERATION', { operation: 'get', url: id })).data.scrollTop, 400);
    assert.equal((await state.get(['markdownViewerSettings'])).markdownViewerSettings.themeId, 'default');
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
