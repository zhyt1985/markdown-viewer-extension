import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {_electron} from 'playwright-core';
import {openWorkspace,documentMenu,selectNav} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(new URL('../package.json',import.meta.url));
test('local chapters, visit history and SUMMARY navigate real scoped documents',{timeout:120000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','reading-navigation');await fs.mkdir(artifacts,{recursive:true});
  const folder=await fs.mkdtemp(path.join(artifacts,'run-')),workspace=path.join(folder,'book');await fs.mkdir(workspace);
  const a=path.join(workspace,'A.md'),b=path.join(workspace,'章节 #%.md');
  const body='# A\n\n[下一章](章节%20%23%25.md#目标)\n\n[越界](../outside.md)\n\n[远程](https://example.com/x.md)\n\n'+Array.from({length:80},(_,i)=>`## 段落 ${i}\n\n正文 ${i}。\n\n`).join('');
  await fs.writeFile(a,body);await fs.writeFile(b,'# B\n\n[返回](A.md)\n\n'+Array.from({length:70},(_,i)=>`段落 ${i}。\n\n`).join('')+'## 目标\n\n正文。');await fs.writeFile(path.join(folder,'outside.md'),'# Outside');
  await fs.writeFile(path.join(workspace,'SUMMARY.md'),'# Summary\n\n- [起始](A.md)\n  - [章节](章节%20%23%25.md#目标)');
  const packaged=process.env.MV_DESKTOP_EXECUTABLE,app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow();const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  try{
    await ready();await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showMessageBox=async()=>({response:2});},workspace);
    await openWorkspace(page);await ready();await page.locator('.tree-file[data-name="A.md"]').click();await ready();
    await t.test('encoded chapter links open within the workspace and locate headings',async()=>{
      await page.locator('#markdown-content a',{hasText:'下一章'}).click();await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'B');
      assert.ok(await page.locator('#reader').evaluate(node=>node.scrollTop)>1000);
      const visible=await page.locator('#markdown-content h2').evaluate(node=>node.getBoundingClientRect().bottom<=document.getElementById('reader').getBoundingClientRect().bottom);assert.equal(visible,true);
      assert.equal(await page.locator('.document-tab').count(),2);assert.equal(await page.locator('#nav-back').isDisabled(),false);
      await page.click('#nav-back');await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'A');
    });
    await t.test('back and forward restore visit positions without overwriting a dirty draft',async()=>{
      await page.locator('#reader').evaluate(node=>node.scrollTop=1200);const top=await page.locator('#reader').evaluate(node=>node.scrollTop);
      await page.locator('.tab-open',{hasText:'章节 #%.md'}).click();await ready();await page.keyboard.press('Alt+ArrowLeft');await ready();
      assert.ok(Math.abs(await page.locator('#reader').evaluate(node=>node.scrollTop)-top)<3);
      await page.locator('[data-shell-mode="split"]').click();await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n本地草稿');await page.evaluate('window.desktopEditor.flush()');
      await page.click('#nav-forward');await ready();await page.click('#nav-back');await ready();assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/本地草稿/);assert.equal(await fs.readFile(a,'utf8'),body);
      await page.locator('[data-shell-mode="reading"]').click();
    });
    await t.test('nested SUMMARY is a readable local directory and reuses chapter tabs',async()=>{
      await documentMenu(page,'#open-summary');await ready();assert.equal(await page.locator('#markdown-content ul ul').count(),1);
      await page.locator('#markdown-content a',{hasText:'章节'}).click();await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'B');assert.equal(await page.locator('.document-tab').count(),3);
      await page.screenshot({path:path.join(artifacts,'chapter.png'),scale:'css'});
    });
    await t.test('failed and remote links leave the active document and history usable',async()=>{
      await page.locator('.tab-open',{hasText:'A.md'}).click();await ready();
      await page.locator('#markdown-content a',{hasText:'越界'}).click();await ready();assert.match(await page.locator('#status').innerText(),/outside/);assert.equal(await page.locator('#markdown-content h1').innerText(),'A');
      await page.locator('#markdown-content a',{hasText:'远程'}).click();await ready();assert.match(await page.locator('#status').innerText(),/相对 Markdown/);assert.equal(await page.locator('.document-tab').count(),3);
    });
    await t.test('a persistent book panel navigates nested and reference chapters from the SUMMARY root',async()=>{
      await fs.mkdir(path.join(workspace,'chapters'));await fs.writeFile(path.join(workspace,'chapters','C.md'),'# C\n\n深层章节。');
      await fs.writeFile(path.join(workspace,'SUMMARY.md'),'# Summary\n\n- [起始](A.md)\n  - [编码章节](章节%20%23%25.md#目标)\n  - [深入][deep]\n- [远程章节](https://example.com/x.md)\n\n[deep]: chapters/C.md');
      await selectNav(page,'book');await page.waitForFunction(()=>document.querySelectorAll('.book-entry').length===4);
      assert.equal(await page.locator('.book-entry[aria-current="page"]').innerText(),'起始');assert.equal(await page.locator('#book-previous').isDisabled(),true);
      await page.click('#book-next');await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'B');
      await page.click('#book-next');await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'C');
      await page.waitForFunction(()=>document.querySelector('.book-entry[aria-current="page"]')?.textContent==='深入');
      await page.screenshot({path:path.join(artifacts,'book-panel.png'),scale:'css'});
      await page.click('#book-next');await ready();assert.match(await page.locator('#status').innerText(),/相对 Markdown/);assert.equal(await page.locator('#markdown-content h1').innerText(),'C');
      await page.click('#book-previous');await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'B');
      await page.click('#book-previous');await ready();assert.match(await page.evaluate('window.desktopCodeEditor.getText()'),/本地草稿/);assert.equal(await fs.readFile(a,'utf8'),body);
    });
    await t.test('refresh reports changed or missing SUMMARY without changing the active chapter',async()=>{
      const summary=path.join(workspace,'SUMMARY.md');await fs.writeFile(summary,'- [起始](A.md)\n- [深入](chapters/C.md)');
      await page.click('#book-refresh');await page.waitForFunction(()=>document.querySelectorAll('.book-entry').length===2);
      await page.locator('.tab-open',{hasText:'SUMMARY.md'}).click();await ready();await page.locator('[data-shell-mode="split"]').click();
      await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+a');await page.keyboard.insertText('- [新草稿章节](A.md)');
      await page.click('#book-refresh');await page.waitForFunction(()=>document.querySelector('.book-entry')?.textContent==='新草稿章节');
      assert.equal(await fs.readFile(summary,'utf8'),'- [起始](A.md)\n- [深入](chapters/C.md)');
      await page.locator('.tab-open',{hasText:'A.md'}).click();await ready();await page.locator('[data-shell-mode="reading"]').click();
      await fs.rename(summary,summary+'.held');await page.click('#book-refresh');await page.waitForFunction(()=>document.getElementById('book-status').textContent.includes('不可用'));
      assert.equal(await page.locator('.book-entry').count(),0);assert.equal(await page.locator('#markdown-content h1').innerText(),'A');await fs.rename(summary+'.held',summary);
      const denied=await page.evaluate(()=>{const doc=window.desktopApp.state().document;return window.desktop.openLocalLink({documentId:doc.documentId,documentVersion:doc.documentVersion,href:'A.md',fromSummary:true,summaryScope:'forged'}).then(()=>false,()=>true);});assert.equal(denied,true);
    });
  }finally{await app.close();}
});
