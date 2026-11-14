import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {parseLink,resolveLink} from '../src/local-navigation.cjs';
test('local Markdown links decode once and remain inside their canonical grant',async()=>{
  const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'documd-links-')));
  try{
    await fs.mkdir(path.join(folder,'root'));await fs.writeFile(path.join(folder,'outside.md'),'outside');
    const root=path.join(folder,'root'),target=path.join(root,'章节 #%.md');await fs.writeFile(target,'# chapter');
    const document={directory:root,resourceRoot:root};
    assert.equal((await resolveLink(document,encodeURIComponent('章节 #%.md')+'#标题')).source,target);
    assert.deepEqual(parseLink('#标题'),{name:'',anchor:'标题'});
    for(const href of ['https://example.com/a.md','file:///C:/a.md','/absolute.md','%2fabsolute.md','a.pdf','a.md?x=1','%00.md','%broken'])await assert.rejects(async()=>resolveLink(document,href));
    await assert.rejects(resolveLink(document,'../outside.md'),/outside/);
    await assert.rejects(resolveLink({...document,untitled:true},'a.md'),/先保存/);
    await fs.symlink(folder,path.join(root,'link'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(resolveLink(document,'link/outside.md'),/outside/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
