import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require=createRequire(import.meta.url);
const {createDraftStore,idFor}=require('../src/draft-store.cjs');
const record=(root,name='A.md',markdown='草稿')=>({source:path.join(root,name),resourceRoot:root,documentId:idFor(path.join(root,name)),markdown,diskVersion:'a'.repeat(64),format:{bom:true,newline:'\r\n'}});

test('untitled drafts persist without file paths and cannot smuggle a filesystem scope',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-untitled-')));
  try {
    const store=createDraftStore(root),draft={untitled:true,title:'未命名 1.md',documentId:'c'.repeat(64),source:null,resourceRoot:null,workspaceRoot:null,diskVersion:null,markdown:'',format:{bom:false,newline:'\n'}};
    await store.put(draft);const initial=await store.get(draft.documentId);assert.equal(initial.kind,'untitled');assert.equal(initial.source,null);assert.equal(initial.markdown,'');
    await store.put({...draft,markdown:'# 保留文本'});assert.equal((await createDraftStore(root).list()).records[0].markdown,'# 保留文本');
    assert.throws(()=>store.put({...draft,source:path.join(root,'fake.md')}),/Invalid/);
    assert.throws(()=>store.put({...draft,resourceRoot:root}),/Invalid/);
    assert.throws(()=>store.put({...draft,title:'../../fake.md'}),/Invalid/);
    await store.remove([draft.documentId]);assert.equal((await store.list()).records.length,0);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('draft acknowledgements survive reopening, serialize edits and explicitly remove only selected drafts',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-drafts-')));
  try {
    const store=createDraftStore(root); const first=record(root);
    await Promise.all([store.put(first),store.put({...first,markdown:'最后一次修改'})]);
    const reopened=createDraftStore(root); const result=await reopened.list();
    assert.equal(result.records.length,1); assert.equal(result.records[0].markdown,'最后一次修改');
    assert.deepEqual(result.records[0].format,first.format);
    await store.put(record(root,'B.md')); await store.remove([first.documentId]);
    assert.equal((await reopened.list()).records[0].source,path.join(root,'B.md'));
    assert.deepEqual((await fs.readdir(root)).filter(name=>name.endsWith('.tmp')),[]);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('corrupt drafts remain on disk; quota and invalid identities cannot replace the last durable draft',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-drafts-')));
  try {
    const store=createDraftStore(root,{maxItems:1,maxBytes:1500}), first=record(root);
    await store.put(first);
    await assert.rejects(store.put(record(root,'B.md')),/上限/);
    await assert.rejects(store.put({...first,markdown:'x'.repeat(3000)}),/上限/);
    assert.equal((await store.get(first.documentId)).markdown,'草稿');
    assert.throws(()=>store.put({...first,source:path.join(root,'..','outside.md')}),/Invalid/);
    await assert.rejects(store.get('../outside'),/identifier/);
    await assert.rejects(store.remove(['../outside']),/identifier/);
    const broken=path.join(root,'b'.repeat(64)+'.json'); await fs.writeFile(broken,'{broken');
    const listed=await store.list(); assert.equal(listed.records.length,1); assert.equal(listed.warnings.length,1);
    assert.equal(await fs.readFile(broken,'utf8'),'{broken');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
