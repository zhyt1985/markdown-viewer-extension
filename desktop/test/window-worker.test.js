import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { WindowWorker } from '../src/window-worker.cjs';

function fakeWindow(execute) {
  const win = new EventEmitter();
  let destroyed = false;
  win.webContents = new EventEmitter();
  win.webContents.executeJavaScript = execute;
  win.ready = Promise.resolve();
  win.isDestroyed = () => destroyed;
  win.destroy = () => { destroyed = true; win.emit('closed'); };
  return win;
}
test('render timeout kills the stuck host and the next job gets a fresh host', async () => {
  const windows = [];
  const worker = new WindowWorker(() => {
    const win = fakeWindow(windows.length ? async () => 'recovered' : () => new Promise(() => {}));
    windows.push(win); return win;
  }, 30);
  try {
    await assert.rejects(worker.run({}, 'a'), /timed out/);
    assert.equal(windows[0].isDestroyed(), true);
    assert.equal(await worker.run({}, 'b'), 'recovered');
  } finally { worker.dispose(); }
});
test('owner cancellation rejects active and queued work without losing other owners', async () => {
  let count = 0;
  const worker = new WindowWorker(() => fakeWindow(count++ ? async () => 'other' : () => new Promise(() => {})));
  const active = assert.rejects(worker.run({}, 'a'), /canceled/);
  const queued = assert.rejects(worker.run({}, 'a'), /canceled/);
  const other = worker.run({}, 'b');
  worker.cancelOwner('a');
  await Promise.all([active, queued]);
  assert.equal(await other, 'other');
  worker.dispose();
});
test('crash and disposal reject pending work rather than returning stale results', async () => {
  const win = fakeWindow(() => new Promise(() => {}));
  const worker = new WindowWorker(() => win);
  const failed = assert.rejects(worker.run({}, 'a'), /crashed/);
  win.webContents.emit('render-process-gone');
  await failed;
  assert.equal(win.isDestroyed(), true);
  const worker2 = new WindowWorker(() => fakeWindow(() => new Promise(() => {})));
  const a = assert.rejects(worker2.run({}, 'a'), /disposed/);
  const b = assert.rejects(worker2.run({}, 'b'), /disposed/);
  worker2.dispose();
  await Promise.all([a, b]);
});
