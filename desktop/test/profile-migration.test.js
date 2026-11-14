import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { migrateProfile } from '../src/profile-migration.cjs';

test('formal profile imports only application state and never replaces new state or edits the legacy profile', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-profile-')));
  try {
    const old = path.join(temporary,'old'), target = path.join(temporary,'new'); await fs.mkdir(old);
    const state = JSON.stringify({ schemaVersion:1, values:{ markdownViewerSettings:{ preferredLocale:'zh_CN' }, 'reading:abc':{ scrollTop:123 }, desktopSession:{ version:1, workspaces:[], documents:[], activeSource:null } } });
    await fs.writeFile(path.join(old,'desktop-state.json'),state); await fs.writeFile(path.join(old,'unrelated.bin'),'leave alone');
    assert.equal((await migrateProfile(target,[old])).status,'imported');
    assert.equal(await fs.readFile(path.join(target,'desktop-state.json'),'utf8'),state);
    assert.deepEqual(await fs.readdir(target),['desktop-state.json']);
    assert.equal(await fs.readFile(path.join(old,'desktop-state.json'),'utf8'),state);
    assert.equal(await fs.readFile(path.join(old,'unrelated.bin'),'utf8'),'leave alone');
    await fs.writeFile(path.join(target,'desktop-state.json'),'new user state');
    assert.equal((await migrateProfile(target,[old])).status,'existing');
    assert.equal(await fs.readFile(path.join(target,'desktop-state.json'),'utf8'),'new user state');
  } finally { await fs.rm(temporary,{recursive:true,force:true}); }
});
test('damaged and linked legacy data remains untouched and missing legacy data is harmless', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-profile-invalid-')));
  try {
    const old = path.join(temporary,'old'); await fs.mkdir(old); await fs.writeFile(path.join(old,'desktop-state.json'),'{broken');
    assert.equal((await migrateProfile(path.join(temporary,'new'),[old])).status,'warning');
    assert.equal(await fs.readFile(path.join(old,'desktop-state.json'),'utf8'),'{broken');
    assert.deepEqual(await fs.readdir(path.join(temporary,'new')),[]);
    assert.equal((await migrateProfile(path.join(temporary,'empty'),[path.join(temporary,'absent')])).status,'empty');
    const link = path.join(temporary,'linked'); await fs.symlink(old,link,process.platform==='win32'?'junction':'dir');
    assert.equal((await migrateProfile(path.join(temporary,'blocked'),[link])).status,'warning');
    assert.deepEqual(await fs.readdir(path.join(temporary,'blocked')),[]);
  } finally { await fs.rm(temporary,{recursive:true,force:true}); }
});
