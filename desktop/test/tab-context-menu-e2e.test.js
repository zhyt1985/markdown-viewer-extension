import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {_electron} from 'playwright-core';
import {openFile} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(new URL('../package.json',import.meta.url));
test('tab context menus close the clicked document or the confirmed group without losing canceled drafts',{timeout:150000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','tab-context-menu');await fs.mkdir(artifacts,{recursive:true});
  const folder=await fs.mkdtemp(path.join(artifacts,'run-')),profile=path.join(folder,'profile');
  const files=['A','B','C'].map(name=>path.join(folder,name+'.md')),contents=['A','B','C'].map(name=>`# ${name}\n\n`+Array.from({length:70},(_,i)=>`正文 ${name} ${i}。\n\n`).join(''));
  await Promise.all(files.map((file,i)=>fs.writeFile(file,contents[i])));
  const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${profile}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000}),page=await app.firstWindow();
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const activate=async name=>{await page.locator('.tab-open').filter({hasText:new RegExp('^'+name+'\\.md')}).click();await ready();};
  const menu=async name=>{await page.locator('.tab-open').filter({hasText:new RegExp('^'+name+'\\.md')}).click({button:'right'});await page.locator('[data-shell-menu="tabs"]').waitFor({state:'visible'});};
  const command=async id=>{await page.click('#tab-close-'+id);await ready();};
  const respond=response=>app.evaluate(({dialog},response)=>{globalThis.__tabConfirmations=[];dialog.showMessageBox=async(_window,options)=>{globalThis.__tabConfirmations.push(options);return {response};};},response);
  const open=async selection=>{await app.evaluate(({dialog},selection)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:selection});},selection);await openFile(page);await ready();};
  const edit=async text=>{await page.locator('[data-shell-mode="split"]').click();await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(text);};
  try{
    await ready();await respond(0);await open(files);await activate('A');
    await t.test('right click targets an inactive tab and close-current leaves the active document and position intact',async()=>{
      await page.locator('#reader').evaluate(node=>node.scrollTop=1000);const top=await page.locator('#reader').evaluate(node=>node.scrollTop);
      await menu('B');assert.equal(await page.locator('.tab-open[aria-selected="true"]').innerText(),'A.md');
      assert.deepEqual(await page.locator('[data-shell-menu="tabs"] button').allTextContents(),['关闭当前文件','关闭其他文件','关闭全部文件']);
      await page.screenshot({path:path.join(artifacts,'context-menu.png'),scale:'css'});
      await command('current');assert.equal(await page.locator('.document-tab').count(),2);assert.equal(await page.locator('.tab-open').filter({hasText:/^B\.md/}).count(),0);
      assert.equal(await page.locator('#markdown-content h1').innerText(),'A');assert.ok(Math.abs(await page.locator('#reader').evaluate(node=>node.scrollTop)-top)<3);
    });
    await t.test('close-others keeps the clicked tab and keyboard menu disables a meaningless close-others action',async()=>{
      await menu('C');await command('others');assert.equal(await page.locator('.document-tab').count(),1);assert.equal(await page.locator('#markdown-content h1').innerText(),'C');
      await page.locator('.tab-open').focus();await page.keyboard.press('Shift+F10');await page.locator('[data-shell-menu="tabs"]').waitFor({state:'visible'});
      assert.equal(await page.locator('#tab-close-others').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#shell-popover').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('tab-open')),true);
    });
    await t.test('canceling close-all retains every clean and dirty tab after flushing the latest typed text',async()=>{
      await open(files);await activate('B');await edit('\nB 未保存稿');await activate('A');await edit('\nA 最新输入稿');
      await menu('C');await command('all');assert.equal(await page.locator('.document-tab').count(),3);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/A 最新输入稿/);
      const prompts=await app.evaluate(()=>globalThis.__tabConfirmations);assert.equal(prompts.length,1);assert.match(prompts[0].message,/2 个文档/);assert.match(prompts[0].detail,/A\.md/);assert.match(prompts[0].detail,/B\.md/);
      await activate('B');assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/B 未保存稿/);await activate('A');
    });
    await t.test('close-others confirms only discarded drafts and keeps the anchor draft untouched',async()=>{
      await respond(1);await menu('A');await command('others');assert.equal(await page.locator('.document-tab').count(),1);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/A 最新输入稿/);assert.equal(await page.evaluate(()=>window.desktopApp.state().dirty),true);
      const prompts=await app.evaluate(()=>globalThis.__tabConfirmations);assert.equal(prompts.length,1);assert.match(prompts[0].message,/1 个文档/);assert.match(prompts[0].detail,/B\.md/);assert.doesNotMatch(prompts[0].detail,/A\.md/);
    });
    await t.test('close-all includes untitled text, cancels atomically, then removes drafts and restores an empty session',async()=>{
      await page.keyboard.press('Control+n');await ready();await edit('# 未命名编辑稿');
      await respond(0);await menu('A');await command('all');assert.equal(await page.locator('.document-tab').count(),2);
      assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/未命名编辑稿/);
      await respond(1);await menu('A');await command('all');assert.equal(await page.locator('.document-tab').count(),0);assert.equal(await page.locator('#welcome').isVisible(),true);
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).filter(name=>name.endsWith('.json')).length,0);
      await page.reload();await ready();assert.equal(await page.locator('.document-tab').count(),0);
      assert.equal(await page.locator('#welcome').isVisible(),true);
      for(let i=0;i<files.length;i++)assert.equal(await fs.readFile(files[i],'utf8'),contents[i]);
    });
    await t.test('stale targets and unknown close operations cannot close other open documents',async()=>{
      await open(files);const before=await page.evaluate('window.desktop.session()');
      const denied=await page.evaluate(async id=>{
        const results=[];for(const payload of [{mode:'all',documentId:'missing'},{mode:'invalid',documentId:id}])results.push(await window.desktop.closeTabs(payload).then(()=>false,()=>true));return results;
      },before.tabs[0].documentId);assert.deepEqual(denied,[true,true]);assert.equal(await page.locator('.document-tab').count(),3);
    });
  }finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:2});});await app.close();}
});
