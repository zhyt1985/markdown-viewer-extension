import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../scripts/typecheck.cjs', import.meta.url), 'utf8');
function exitStatus(run) {
  let status;
  assert.throws(() => vm.runInNewContext(source, {
    __dirname: new URL('../../scripts/', import.meta.url).pathname,
    require: Object.assign(name => {
      if (name === 'node:child_process') return { spawnSync: () => run };
      if (name === 'node:fs') return { readFileSync: () => '{"name":"fixture"}' };
      return require(name);
    }, { resolve: require.resolve }),
    console: { log() {}, error() {} },
    process: { execPath: process.execPath, exit(code) { status = code; throw new Error('exit'); } },
  }), /exit/);
  return status;
}
test('typecheck fails closed for startup, unclassified errors and project errors alongside vendor diagnostics', () => {
  assert.equal(exitStatus({ status: null, error: new Error('spawn denied') }), 1);
  assert.equal(exitStatus({ status: 1, stdout: 'node_modules\\vendor\\a.ts(1,1): error TS7006: bad\nerror TS9999: unknown' }), 1);
  assert.equal(exitStatus({ status: 1, stdout: 'node_modules/vendor/a.ts(1,1): error TS7006: bad\nsrc/a.ts(1,1): error TS2322: bad' }), 1);
  assert.equal(exitStatus({ status: 1, stdout: 'compiler failed without diagnostics' }), 1);
  assert.equal(exitStatus({ status: 1, stdout: 'node_modules\\vendor\\a.ts(1,1): error TS7006: bad' }), 0);
  assert.equal(exitStatus({ status: 0, stdout: '' }), 0);
});
