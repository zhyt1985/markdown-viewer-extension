import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import { launchDesktop,openFile} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('real startup, second processes and native file drops share one safe document-opening flow',{timeout:180000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','open-entry');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-'));
  const profile=path.join(folder,'profile'),workspace=path.join(folder,'我的 工作区');await fs.mkdir(workspace);
  const a=path.join(workspace,'A 中文 #%.md'),b=path.join(workspace,'B.md'),c=path.join(workspace,'C.markdown');
  const invalid=path.join(workspace,'坏编码.md'),other=path.join(workspace,'unsupported.bin'),missing=path.join(folder,'missing.md');
  await fs.writeFile(a,'# 首次打开');await fs.writeFile(b,'# 第二个文件');await fs.writeFile(c,'# 第三个文件');await fs.writeFile(invalid,Buffer.from([0xff]));await fs.writeFile(other,'unsupported');
  const packaged=process.env.MV_DESKTOP_EXECUTABLE,executable=packaged||require('electron');
  const args=files=>[`--user-data-dir=${profile}`,...(packaged?[]:[path.join(root,'dist/desktop/app')]),...files];
  const env={...process.env,ELECTRON_RUN_AS_NODE:undefined};
  const app=await launchDesktop({executablePath:executable,args:args([a]),env,timeout:60000});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const selected=filename=>page.waitForFunction(name=>window.desktopApp.state().document?.filename===name&&!window.desktopApp.state().busy,filename,{timeout:20000});
  const second=files=>new Promise((resolve,reject)=>{
    const child=spawn(executable,args(files),{cwd:folder,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Secondary process did not exit'));},20000);
    child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Secondary exit ${code}: ${output}`));});
  });
  let cdp;
  const drag=async(files,{screenshot=false}={})=>{
    await page.evaluate(()=>{window.__dropAudit=null;window.addEventListener('drop',event=>{window.__dropAudit={trusted:event.isTrusted,names:Array.from(event.dataTransfer?.files||[]).map(file=>file.name),types:Array.from(event.dataTransfer?.types||[])};},{once:true,capture:true});});
    cdp ||= await page.context().newCDPSession(page);
    const data={items:[],files,dragOperationsMask:1};
    await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',x:600,y:300,data});
    await cdp.send('Input.dispatchDragEvent',{type:'dragOver',x:600,y:300,data});
    if(screenshot){await page.waitForFunction(()=>!document.getElementById('drop-overlay').hidden);await page.screenshot({path:path.join(artifacts,'drop-target.png'),scale:'css'});}
    await cdp.send('Input.dispatchDragEvent',{type:'drop',x:600,y:300,data});
  };
  const edit=async value=>{
    if(!await page.locator('#editor-pane').isVisible())await page.locator('[data-shell-mode="split"]').click();
    await page.locator('#markdown-editor').focus();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.insertText(value);
    await page.waitForFunction(text=>window.desktopCodeEditor.getText()===text,value);await page.evaluate('window.desktopEditor.flush()');
  };
  try {
    await ready();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
    await t.test('cold startup opens Unicode paths through the GUI and owns the profile lock',async()=>{
      await selected(path.basename(a));assert.equal(await page.locator('#markdown-content h1').innerText(),'首次打开');
      assert.equal(await app.evaluate(({app})=>app.hasSingleInstanceLock()),true);
      assert.equal((await page.evaluate('window.desktop.session()')).workspaces.length,0,JSON.stringify(await app.evaluate(({app})=>({argv:process.argv,packaged:app.isPackaged,entry:app.getAppPath()}))));
      assert.equal(await page.evaluate('typeof window.desktop.openPath'), 'undefined');
      assert.equal(await page.evaluate('window.desktop.openPending("forged").then(()=>false,()=>true)'),true);
    });
    await t.test('a real second process restores the existing window, opens files and preserves dirty tabs',async()=>{
      await edit('# 未保存的 A 草稿');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize());
      await second([b,c]);await selected('B.md');assert.equal(await page.locator('.document-tab').count(),3);
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/index.html')).length),1);
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).isMinimized()),false);
      await second([a]);await selected(path.basename(a));assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 未保存的 A 草稿');
      assert.equal(await fs.readFile(a,'utf8'),'# 首次打开');assert.equal(await page.locator('.document-tab').count(),3);
      await second([]);assert.equal(await page.locator('.document-tab').count(),3);
    });
    await t.test('native file and directory drops register workspaces and reuse the dirty source',async()=>{
      await drag([workspace,a,b],{screenshot:true});
      try {await page.waitForFunction(()=>document.querySelectorAll('#workspaces section').length===1&&!window.desktopApp.state().busy,null,{timeout:10000});}
      catch(error){
        const diagnostic=await page.evaluate(async()=>({audit:window.__dropAudit,notice:document.getElementById('open-notice-text').textContent,status:document.getElementById('status').textContent,count:document.querySelectorAll('#workspaces section').length,busy:window.desktopApp.state().busy,session:await window.desktop.session(),pending:await window.desktop.pendingOpens()}));
        delete diagnostic.session.selected;throw Error(`${error.message}\n${JSON.stringify(diagnostic)}`);
      }
      assert.equal(await page.locator('.document-tab').count(),3);assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 未保存的 A 草稿');
      assert.equal(await page.locator('#drop-overlay').isVisible(),false);assert.equal(await page.url(),'documd://viewer/index.html');
      await drag([workspace]);await page.waitForTimeout(250);assert.equal(await page.locator('#workspaces section').count(),1);
    });
    await t.test('mixed invalid files report failures without removing valid files or the active draft',async()=>{
      await second([missing,invalid,other,b]);await selected('B.md');
      await page.waitForFunction(()=>document.getElementById('open-notice-text').textContent.includes('UTF-8'));
      const warning=await page.locator('#open-notice-text').innerText();assert.match(warning,/missing.md/);assert.match(warning,/unsupported.bin/);
      await second([invalid]);await page.waitForTimeout(300);assert.equal(await page.evaluate('window.desktopApp.state().document.filename'),'B.md');
      assert.equal(await page.locator('.document-tab').count(),3);
      await second([a]);await selected(path.basename(a));assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 未保存的 A 草稿');
      await page.click('#dismiss-open-notice');assert.equal(await page.locator('#open-notice').isVisible(),false);
    });
    await t.test('incoming opens wait behind a native file dialog and flush the latest editor text first',async()=>{
      await edit('# 切换前最新 A 草稿');
      await app.evaluate(({dialog})=>{dialog.showOpenDialog=()=>new Promise(resolve=>{globalThis.__finishNativeOpen=()=>resolve({canceled:true,filePaths:[]});});});
      await openFile(page);await page.waitForFunction(()=>document.getElementById('open').disabled);
      await second([b]);assert.equal(await page.evaluate('window.desktopApp.state().document.filename'),path.basename(a));
      await app.evaluate(()=>{globalThis.__finishNativeOpen();delete globalThis.__finishNativeOpen;});await selected('B.md');
      await second([a]);await selected(path.basename(a));assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 切换前最新 A 草稿');
    });
    await t.test('web links and synthetic File objects cannot become local path grants',async()=>{
      await page.evaluate(()=>{
        const data=new DataTransfer();data.items.add(new File(['# synthetic'],'fake.md',{type:'text/markdown'}));
        window.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
      });
      await second(['https://example.com/remote.md']);
      await page.waitForFunction(()=>document.getElementById('open-notice-text').textContent.includes('不打开网址'));
      assert.equal(await page.locator('.document-tab').count(),3);assert.equal(await page.url(),'documd://viewer/index.html');
      assert.equal(await fs.readFile(a,'utf8'),'# 首次打开');assert.deepEqual(errors,[]);
    });
    await t.test('canceling a held close confirmation resumes queued external opens without losing the draft',async()=>{
      await app.evaluate(({dialog,BrowserWindow})=>{
        dialog.showMessageBox=()=>new Promise(resolve=>{globalThis.__finishClosePrompt=()=>resolve({response:0});});
        BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).close();
      });
      for(let attempt=0;attempt<100&&!await app.evaluate(()=>typeof globalThis.__finishClosePrompt==='function');attempt++)await page.waitForTimeout(10);
      await second([b]);assert.equal(await page.evaluate('window.desktopApp.state().document.filename'),path.basename(a));
      await app.evaluate(()=>{globalThis.__finishClosePrompt();delete globalThis.__finishClosePrompt;});await selected('B.md');
      await second([a]);await selected(path.basename(a));assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 切换前最新 A 草稿');
      assert.equal(await fs.readFile(a,'utf8'),'# 首次打开');
    });
    await t.test('dropping a code file opens a read-only tab and retains the Markdown draft', async () => {
      const code = path.join(workspace, '配置.yaml');
      await fs.writeFile(code, 'enabled: true\n');
      await drag([code]);
      await selected(path.basename(code));
      assert.equal(await page.locator('#mv-source-view .mv-source-line-content').textContent(), 'enabled: true');
      assert.equal(await page.locator('#editor-pane').isHidden(), true);
      await page.locator('.tab-open', { hasText: path.basename(a) }).click();
      await selected(path.basename(a));
      assert.equal(await page.evaluate(() => window.desktopCodeEditor.getText()), '# 切换前最新 A 草稿');
    });
  } finally {await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:2});});await app.close();}
});
