import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {_electron} from 'playwright-core';
import {unzipSync} from 'fflate';
import {closeDialogs,openFile,exportFile} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('new untitled documents survive restarts and become real files without losing editor state',{timeout:180000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','untitled');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-')),profile=path.join(folder,'profile');
  const peer=path.join(folder,'已打开.md');await fs.writeFile(peer,'# 已打开文件不能被覆盖');
  let app,page,first,second,empty;
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const current=()=>page.evaluate('window.desktopApp.state().document');
  const settled=()=>page.waitForFunction(()=>window.desktopApp.state().preview.current,null,{timeout:20000});
  const edit=async text=>{await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+a');await page.keyboard.insertText(text);await page.waitForFunction(value=>window.desktopCodeEditor.getText()===value,text);await page.evaluate('window.desktopEditor.flush()');};
  const create=async()=>{await closeDialogs(page);await page.keyboard.press('Control+n');await ready();return current();};
  const chooseSave=filePath=>app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},filePath);
  const save=async()=>{await page.click('#save');await ready();};
  const discard=response=>app.evaluate(({dialog},response)=>{dialog.showMessageBox=async()=>({response});},response);
  const activate=async id=>{await page.locator(`.document-tab[data-document-id="${id}"] .tab-open`).click();await ready();};
  const crash=async()=>{const exited=app.waitForEvent('close');await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await exited;app=null;};
  const launch=async()=>{
    const packaged=process.env.MV_DESKTOP_EXECUTABLE;
    app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${profile}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
    page=await app.firstWindow();await ready();await discard(0);
  };
  try {
    await launch();
    await t.test('welcome and keyboard create independent durable documents without a resource grant',async()=>{
      await page.locator('#welcome [data-shell-action="new-document"]').click();await ready();first=await current();
      assert.equal(first.untitled,true);assert.equal(first.filename,'未命名 1.md');assert.equal(first.documentPath,'');assert.equal(first.documentDir,'');
      assert.equal(await page.locator('#editor-pane').isVisible(),true);assert.equal(await page.locator('#save').isDisabled(),false);assert.equal(await page.locator('#reload-file').isDisabled(),true);
      assert.equal(await page.locator('#file-status').isVisible(),true);assert.match(await page.locator('#file-status').innerText(),/尚未保存到文件/);
      assert.equal(await page.evaluate(url=>fetch(url+'/secret.svg').then(r=>r.status),first.documentBaseUrl),403);
      assert.equal(await page.evaluate(()=>{try{globalThis.platform.document.resolvePath('secret.svg');return false;}catch{return true;}}),true);
      await edit('# 第一份初稿');second=await create();await edit('# 第二份独立草稿');
      assert.notEqual(first.documentId,second.documentId);assert.equal(second.filename,'未命名 2.md');
      await activate(first.documentId);assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 第一份初稿');
      assert.equal((await page.evaluate('window.desktop.recent()')).length,0);
      const records=await fs.readdir(path.join(profile,'drafts'));assert.equal(records.filter(name=>name.endsWith('.json')).length,2);
      await page.screenshot({path:path.join(artifacts,'new-document.png'),scale:'css'});
    });
    await t.test('canceling a first save retains identity and text; invalid destinations cannot consume the draft',async()=>{
      await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await save();assert.equal((await current()).documentId,first.documentId);
      assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 第一份初稿');
      await chooseSave(path.join(folder,'invalid.txt'));await save();assert.match(await page.locator('#status').innerText(),/Markdown destination/);assert.equal((await current()).untitled,true);
      await chooseSave(path.join(folder,'missing-directory','new.md'));await save();assert.equal((await current()).documentId,first.documentId);
      await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},peer);await openFile(page);await ready();await activate(first.documentId);
      await chooseSave(peer);await save();assert.match(await page.locator('#status').innerText(),/Cannot overwrite/);assert.equal(await fs.readFile(peer,'utf8'),'# 已打开文件不能被覆盖');
    });
    let savedFile,savedId,long;
    await t.test('the first real save migrates identity and reading position while retaining undo and redo',async()=>{
      long='# 首次保存\n\n'+Array.from({length:100},(_,i)=>`## 段落 ${i}\n\n正文 ${i}。\n\n`).join('');
      await edit(long);await settled();await page.locator('#reader').evaluate(node=>{node.scrollTop=1300;});
      await page.waitForFunction(()=>document.getElementById('reader').scrollTop>1200);const top=await page.locator('#reader').evaluate(node=>node.scrollTop);
      savedFile=path.join(folder,'首次保存 中文.md');await chooseSave(savedFile);await save();const saved=await current();savedId=saved.documentId;
      assert.equal(saved.untitled,false);assert.notEqual(savedId,first.documentId);assert.equal(saved.filename,path.basename(savedFile));assert.equal(await fs.readFile(savedFile,'utf8'),long);
      assert.ok(Math.abs(await page.locator('#reader').evaluate(node=>node.scrollTop)-top)<3);
      assert.equal(await page.locator(`.document-tab[data-document-id="${first.documentId}"]`).count(),0);assert.equal(await page.locator('.document-tab').count(),3);
      await page.click('[data-editor-command="undo"]');await page.evaluate('window.desktopEditor.flush()');assert.notEqual(await page.evaluate('window.desktopCodeEditor.getText()'),long);
      await page.click('[data-editor-command="redo"]');await page.evaluate('window.desktopEditor.flush()');assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),long);
      const values=JSON.parse(await fs.readFile(path.join(profile,'desktop-state.json'),'utf8')).values;
      assert.equal(values[`reading:${first.documentId}`],undefined);assert.ok(values[`reading:${savedId}`]);
      assert.ok((await page.evaluate('window.desktop.recent()')).some(item=>item.documentPath===savedFile));
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).includes(first.documentId+'.json'),false);
    });
    await t.test('blank and edited untitled tabs keep their identities through an abrupt process restart',async()=>{
      empty=await create();assert.equal(empty.dirty,false);await activate(second.documentId);await crash();await launch();
      assert.equal((await current()).documentId,second.documentId);assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 第二份独立草稿');
      await activate(empty.documentId);assert.equal((await current()).filename,empty.filename);assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'');
      assert.equal(await fs.readFile(savedFile,'utf8'),long);assert.equal(await page.locator('.document-tab').count(),4);
    });
    await t.test('discard is explicit, removes only the selected untitled draft and does not return after restart',async()=>{
      await activate(second.documentId);await page.locator(`.document-tab[data-document-id="${second.documentId}"] .tab-close`).click();await ready();assert.equal((await current()).documentId,second.documentId);
      await discard(1);await page.locator(`.document-tab[data-document-id="${second.documentId}"] .tab-close`).click();await ready();
      await activate(empty.documentId);await page.locator(`.document-tab[data-document-id="${empty.documentId}"] .tab-close`).click();await ready();
      await crash();await launch();assert.equal(await page.locator('.document-tab').count(),2);assert.equal((await current()).untitled,false);
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).filter(name=>name.endsWith('.json')).length,0);
    });
    await t.test('failed creation leaves the active real document intact instead of creating an unprotected tab',async()=>{
      const directory=path.join(profile,'drafts'),backup=path.join(profile,'drafts-held');await fs.rename(directory,backup);await fs.writeFile(directory,'unavailable');
      const before=await current();
      try {await create();assert.equal((await current()).documentId,before.documentId);assert.equal(await page.locator('.document-tab').count(),2);assert.match(await page.locator('#status').innerText(),/操作失败/);}
      finally {await fs.rm(directory);await fs.rename(backup,directory);}
    });
    await t.test('an untouched blank document can be saved as an actual empty Markdown file',async()=>{
      const draft=await create(),target=path.join(folder,'空白新文档.md');assert.equal(draft.dirty,false);
      await chooseSave(target);await save();assert.equal((await current()).untitled,false);assert.equal((await fs.stat(target)).size,0);
      assert.equal(await page.locator('#save').isDisabled(),true);assert.equal(await page.locator('#reload-file').isDisabled(),false);
      const id=(await current()).documentId;await page.locator(`.document-tab[data-document-id="${id}"] .tab-close`).click();await ready();
    });
    await t.test('relative local assets are denied before saving and resolve from the selected destination afterward',async()=>{
      const image=path.join(folder,'local.svg');await fs.writeFile(image,'<svg xmlns="http://www.w3.org/2000/svg" width="90" height="30"><text y="20">LOCAL</text></svg>');
      const draft=await create();await edit('# 相对资源\n\n![local](local.svg)');
      await page.waitForFunction(()=>document.getElementById('status').textContent.includes('预览失败'));
      assert.equal(await page.locator('#save').isDisabled(),false);const target=path.join(folder,'资源文档.md');await chooseSave(target);await save();
      assert.equal((await current()).untitled,false);assert.equal(await page.locator('#markdown-content img').evaluate(node=>node.naturalWidth>0),true);
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).includes(draft.documentId+'.json'),false);
    });
    await t.test('an untitled export retains its snapshot while the draft is saved for the first time',async()=>{
      await create();await edit('# Export before first save');await settled();
      const output=path.join(folder,'untitled.docx'),destination=path.join(folder,'导出期间首次保存.md');
      await app.evaluate(({dialog},paths)=>{dialog.showSaveDialog=(_parent,options)=>options.filters[0].extensions.includes('docx')?new Promise(resolve=>{globalThis.__finishUntitledExport=()=>resolve({canceled:false,filePath:paths.output});}):Promise.resolve({canceled:false,filePath:paths.destination});},{output,destination});
      await exportFile(page,'docx');for(let attempt=0;attempt<100&&!await app.evaluate(()=>typeof globalThis.__finishUntitledExport==='function');attempt++)await page.waitForTimeout(10);
      assert.equal(await app.evaluate(()=>typeof globalThis.__finishUntitledExport),'function',await page.locator('#status').innerText());
      await edit('# Body after first save');await save();assert.equal((await current()).untitled,false,await page.locator('#status').innerText());
      await app.evaluate(()=>{globalThis.__finishUntitledExport();delete globalThis.__finishUntitledExport;});await page.waitForFunction(()=>!window.desktopApp.state().exporting,null,{timeout:60000});
      const entries=unzipSync(new Uint8Array(await fs.readFile(output))),xml=new TextDecoder().decode(entries['word/document.xml']);assert.match(xml,/Export before first save/);assert.doesNotMatch(xml,/Body after first save/);
      assert.equal(await fs.readFile(destination,'utf8'),'# Body after first save');
    });
  } finally {if(app){await discard(2);await app.close();}}
});
