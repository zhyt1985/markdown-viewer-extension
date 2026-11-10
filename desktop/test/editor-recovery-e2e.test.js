import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {_electron} from 'playwright-core';
import {openFile,documentMenu,closeDialogs,openSettings} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('CodeMirror history, replacement and durable drafts work through real process restarts', {timeout:180000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','recovery');
  await fs.mkdir(artifacts,{recursive:true}); const folder=await fs.mkdtemp(path.join(artifacts,'run-'));
  const profile=path.join(folder,'profile'),a=path.join(folder,'A.md'),b=path.join(folder,'B.md');
  await fs.writeFile(a,'# 原文\n\n原文正文'); await fs.writeFile(b,'# B 原文');
  let app,page;
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const text=()=>page.evaluate('window.desktopCodeEditor.getText()');
  const edit=async value=>{await page.fill('#markdown-editor',value);await page.waitForFunction(expected=>window.desktopCodeEditor.getText()===expected,value);await page.evaluate('window.desktopEditor.flush()');};
  const launch=async()=>{
    const packaged=process.env.MV_DESKTOP_EXECUTABLE;
    app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${profile}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
    page=await app.firstWindow(); await ready();
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  };
  const crash=async()=>{const exited=app.waitForEvent('close'); await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await exited;app=null;};
  try {
    await launch(); await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[a,b]);
    await openFile(page);await ready();await page.locator('[data-shell-mode="split"]').click();
    await t.test('find and replace, independent tab history, and history after saving',async()=>{
      assert.ok(await page.locator('.cm-lineNumbers').count());
      await page.locator('[data-editor-command="search"]').click();
      await page.fill('.cm-search input[name="search"]','原文'); await page.fill('.cm-search input[name="replace"]','编辑');
      await page.click('.cm-search button[name="replaceAll"]'); await page.evaluate('window.desktopEditor.flush()');
      assert.equal(await text(),'# 编辑\n\n编辑正文');await page.click('.cm-search button[name="close"]');
      await page.locator('.tab-open',{hasText:'B.md'}).click();await ready();await edit('# B 编辑');
      await page.locator('.tab-open',{hasText:'A.md'}).click();await ready();
      await page.click('[data-editor-command="undo"]');await page.evaluate('window.desktopEditor.flush()');assert.equal(await text(),'# 原文\n\n原文正文');
      await page.click('[data-editor-command="redo"]');await page.evaluate('window.desktopEditor.flush()');
      await page.click('#save');await ready();assert.equal(await fs.readFile(a,'utf8'),'# 编辑\n\n编辑正文');
      await page.click('[data-editor-command="undo"]');await page.evaluate('window.desktopEditor.flush()');assert.equal(await text(),'# 原文\n\n原文正文');
      assert.equal(await page.locator('#save').isDisabled(),false);
      await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
      await documentMenu(page,'#reload-file');await ready();assert.equal(await page.locator('[data-editor-command="undo"]').isDisabled(),true);
      await edit('# 崩溃前草稿\n\n不会覆盖磁盘。');
      assert.equal(await page.locator('#save-indicator').innerText(),'草稿已暂存');
      await page.screenshot({path:path.join(artifacts,'editor.png'),scale:'css'});
      await openSettings(page);await page.selectOption('#appearance','dark');await closeDialogs(page);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setContentSize(960,640));
      await page.locator('[data-editor-command="search"]').click();
      await page.screenshot({path:path.join(artifacts,'editor-search-dark-minimum.png'),scale:'css'});
      const bounds=await page.locator('.cm-search').evaluate(panel=>({width:panel.clientWidth,scroll:panel.scrollWidth}));
      assert.ok(bounds.scroll<=bounds.width+2,'search controls fit the source pane at minimum window width');
      const palette=await page.locator('.cm-search button[name="next"]').evaluate(button=>({text:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor}));
      assert.equal(palette.text,'rgb(229, 233, 242)');assert.equal(palette.background,'rgb(34, 38, 48)');
      await page.click('.cm-search button[name="close"]');
    });
    await t.test('an abrupt app exit restores all drafts and detects disk conflicts',async()=>{
      await crash();await fs.writeFile(a,'# 外部更改');await launch();
      assert.equal(await text(),'# 崩溃前草稿\n\n不会覆盖磁盘。');assert.equal(await page.locator('#editor-pane').isVisible(),true);
      assert.match(await page.locator('#file-status').innerText(),/已恢复本地草稿/);
      await page.click('#save');await ready();assert.match(await page.locator('#status').innerText(),/SAVE_CONFLICT/);assert.equal(await fs.readFile(a,'utf8'),'# 外部更改');
      await page.locator('.tab-open',{hasText:'B.md'}).click();await ready();assert.equal(await text(),'# B 编辑');
      await page.locator('.tab-open',{hasText:'A.md'}).click();await ready();
    });
    await t.test('a deleted source still recovers text and can be saved under a new name',async()=>{
      await crash();await fs.rm(a);await launch();assert.match(await text(),/崩溃前草稿/);
      const copy=path.join(folder,'恢复.md');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},copy);
      await closeDialogs(page);await page.click('[data-shell-action="file-menu"]');await page.click('#save-as');await ready();
      assert.equal(await fs.readFile(copy,'utf8'),'# 崩溃前草稿\n\n不会覆盖磁盘。');
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).filter(name=>name.endsWith('.json')).length,1);
    });
    await t.test('explicit discard removes the durable draft and does not reappear on restart',async()=>{
      await page.locator('.tab-open',{hasText:'B.md'}).click();await ready();
      await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
      await page.locator('.document-tab.selected .tab-close').click();await ready();
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).filter(name=>name.endsWith('.json')).length,0);
      await crash();await launch();assert.equal(await page.locator('.tab-open',{hasText:'B.md'}).count(),0);
      assert.equal(await fs.readFile(b,'utf8'),'# B 原文');
    });
    await t.test('storage failure preserves the editable text and explicitly reports the failed backup',async()=>{
      await page.locator('[data-shell-mode="split"]').click();
      const directory=path.join(profile,'drafts'),backup=path.join(profile,'drafts-held');
      await fs.rename(directory,backup);await fs.writeFile(directory,'unavailable');
      try {
        await edit('# 暂存失败仍可取回');
        assert.equal(await text(),'# 暂存失败仍可取回');
        assert.equal(await page.locator('#save-indicator').innerText(),'暂存失败');
        assert.match(await page.locator('#file-status').innerText(),/草稿暂存失败/);
      } finally {await fs.rm(directory);await fs.rename(backup,directory);}
      // Closing retries the durable write for every dirty document.
      await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
      const exited=app.waitForEvent('close');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).close());
      await exited;app=null;await launch();assert.equal(await text(),'# 暂存失败仍可取回');
      assert.match(await page.locator('#file-status').innerText(),/已恢复本地草稿/);
    });
    await t.test('discarding the window removes backups before the next launch',async()=>{
      await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:2});});
      const exited=app.waitForEvent('close');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).close());
      await exited;app=null;await launch();assert.match(await text(),/崩溃前草稿/);
      assert.equal(await page.locator('#save').isDisabled(),true);
      assert.equal((await fs.readdir(path.join(profile,'drafts'))).filter(name=>name.endsWith('.json')).length,0);
    });
    await t.test('draft recovery takes priority over stale clean session tabs without exceeding the tab limit',async()=>{
      await page.locator('[data-shell-mode="split"]').click();await edit('# 优先恢复的草稿');await crash();
      const stateFile=path.join(profile,'desktop-state.json');const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
      const clean=[];
      for(let index=0;index<32;index++) {
        const source=path.join(folder,`clean-${index}.md`);await fs.writeFile(source,`# Clean ${index}`);
        clean.push({source,resourceRoot:folder,workspaceRoot:null});
      }
      // Simulate a stale session snapshot after a failed session-state write.
      state.values.desktopSession={version:1,workspaces:[],documents:clean,activeSource:clean[0].source};
      await fs.writeFile(stateFile,JSON.stringify(state));await launch();
      assert.equal(await page.locator('.document-tab').count(),32);
      const draft=page.locator('.tab-open',{hasText:'恢复.md'});await draft.click();await ready();assert.equal(await text(),'# 优先恢复的草稿');
      assert.match(await page.locator('#session-status').textContent(),/优先恢复草稿/);
    });
  } finally {if(app) {await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:2});});await app.close();}}
});
