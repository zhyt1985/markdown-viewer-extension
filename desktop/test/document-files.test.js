import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { readDocument, writeDocument } from '../src/document-files.cjs';
import { createDocumentMonitor } from '../src/document-monitor.cjs';

test('checked writes preserve BOM/CRLF and refuse conflicts, deletion, invalid UTF-8 and linked paths', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-save-'));
  try {
    const root = await fs.realpath(temporary); const source = path.join(root, '中文.md');
    await fs.writeFile(source, '\uFEFF# 原文\r\n\r\n正文\r\n');
    const initial = await readDocument(root, source);
    assert.deepEqual(initial.format, { bom: true, newline: '\r\n' });
    const saved = await writeDocument({ root, source, markdown: '# 编辑\n\n第二行\n', format: initial.format, expectedVersion: initial.diskVersion });
    assert.equal(await fs.readFile(source, 'utf8'), '\uFEFF# 编辑\r\n\r\n第二行\r\n');
    await fs.writeFile(source, '# 外部修改');
    await assert.rejects(writeDocument({ root, source, markdown: '# 不应覆盖', format: initial.format, expectedVersion: saved.diskVersion }), /SAVE_CONFLICT/);
    assert.equal(await fs.readFile(source, 'utf8'), '# 外部修改');
    await fs.rm(source);
    await assert.rejects(writeDocument({ root, source, markdown: '# 不应重建', format: initial.format, expectedVersion: saved.diskVersion }), /SAVE_CONFLICT/);
    await fs.writeFile(source, Buffer.from([0xff, 0xfe])); await assert.rejects(readDocument(root, source), /UTF-8/);
    const outside = path.join(root, 'other'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'real.md'), '# target');
    await fs.rm(source); const linked = path.join(root, 'linked');
    await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(readDocument(root, path.join(linked, 'real.md')), /replaced/);
    assert.deepEqual((await fs.readdir(root)).filter(name => name.endsWith('.tmp')), []);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('a change during staged writing is rejected before rename and temporary output is cleaned', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-save-race-'));
  const originalOpen = fs.open;
  try {
    const root = await fs.realpath(temporary); const source = path.join(root, 'A.md'); await fs.writeFile(source, '# base');
    const base = await readDocument(root, source);
    fs.open = async (...args) => {
      const file = await originalOpen(...args);
      if (String(args[0]).endsWith('.tmp')) {
        const originalSync = file.sync.bind(file);
        file.sync = async () => { await originalSync(); await fs.writeFile(source, '# concurrent'); };
      }
      return file;
    };
    await assert.rejects(writeDocument({ root, source, markdown: '# local', format: base.format, expectedVersion: base.diskVersion }), /SAVE_CONFLICT/);
    assert.equal(await fs.readFile(source, 'utf8'), '# concurrent');
    assert.deepEqual(await fs.readdir(root), ['A.md']);
  } finally { fs.open = originalOpen; await fs.rm(temporary, { recursive: true, force: true }); }
});

test('file monitoring notices replacement/deletion/recreation and releases removed records', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-monitor-'));
  let monitor;
  try {
    const root = await fs.realpath(temporary); const source = path.join(root, 'A.md'); await fs.writeFile(source, '# A');
    const events = []; monitor = createDocumentMonitor(event => events.push(event), 3600000);
    monitor.watch({ documentId: 'A', source, resourceRoot: root, ...await readDocument(root, source) });
    await monitor.poll(); assert.equal(events.length, 0);
    const replacement = path.join(root, 'replacement.md'); await fs.writeFile(replacement, '# replaced'); await fs.rename(replacement, source);
    await monitor.poll(); assert.equal(events.length, 1); assert.equal(events[0].error, null);
    await fs.rm(source); await monitor.poll(); assert.equal(events.length, 2); assert.ok(events[1].error);
    await monitor.poll(); assert.equal(events.length, 2);
    await fs.writeFile(source, '# recreated'); await monitor.poll(); assert.equal(events.length, 3);
    monitor.unwatch('A'); await fs.writeFile(source, '# ignored'); await monitor.poll(); assert.equal(events.length, 3);
    monitor.dispose(); await monitor.poll(); assert.equal(events.length, 3);
  } finally { monitor?.dispose(); await fs.rm(temporary, { recursive: true, force: true }); }
});
