import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
const {launchPaths,localPath,createOpenInbox}=require('../src/open-inbox.cjs');
test('GUI launch arguments separate Electron flags and keep local paths without conversion commands',()=>{
  assert.deepEqual(launchPaths(['electron','app','--user-data-dir','profile','--inspect=0','笔记 A.md','B.markdown'],true),['笔记 A.md','B.markdown']);
  assert.deepEqual(launchPaths(['electron','--inspect=0','--remote-debugging-port=0','--user-data-dir=profile','app','A.md'],true),['A.md']);
  assert.deepEqual(launchPaths(['app.exe','--user-data-dir=profile','--','-文件.md']),['-文件.md']);
  assert.equal(launchPaths(['app.exe',...Array.from({length:100},(_,i)=>`${i}.md`)]).length,33);
  assert.equal(localPath('笔记 A.md',process.cwd()),path.join(process.cwd(),'笔记 A.md'));
  for(const value of ['https://example.com/x.md','file:///C:/x.md','\\\\server\\share\\x.md','//server/share/x.md','a\0.md'])assert.throws(()=>localPath(value,process.cwd()));
});
test('opaque open requests retain order, bound workload and never consume an unknown identifier',()=>{
  const inbox=createOpenInbox(2),cwd=process.cwd();
  const first=inbox.push(['A.md'],cwd,'startup'),second=inbox.push(['B.md'],cwd,'drop');
  assert.deepEqual(inbox.pending().map(item=>item.id),[first,second]);assert.equal(inbox.pending()[0].paths,undefined);
  assert.throws(()=>inbox.push(['C.md'],cwd,'system'),/过多/);
  assert.throws(()=>inbox.take('forged'));assert.equal(inbox.size,2);
  assert.deepEqual(inbox.take(first).paths,['A.md']);assert.throws(()=>inbox.take(first));
  assert.throws(()=>inbox.push(Array(33).fill('a.md'),cwd,'drop'),/32/);
  inbox.warn('test warning');assert.deepEqual(inbox.warnings(),['test warning']);assert.deepEqual(inbox.warnings(),[]);
});
