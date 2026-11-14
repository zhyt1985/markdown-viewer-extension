import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import { launchDesktop,openFile,openSettings,closeDialogs} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('live preview and bidirectional source mapping preserve current revisions and editing responsiveness',{timeout:180000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','live-preview');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-'));
  const a=path.join(folder,'A.md'),b=path.join(folder,'B.md');await fs.writeFile(a,'# 初始正文');await fs.writeFile(b,'# B 正文');
  const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await launchDesktop({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const settled=async()=>{
    try {await page.waitForFunction(()=>window.desktopApp.state().preview.current,null,{timeout:10000});}
    catch(error){
      const diagnostic=await page.evaluate(()=>({preview:window.desktopApp.state().preview,status:document.getElementById('status').textContent,content:document.getElementById('markdown-content').textContent.slice(0,400)}));
      throw Error(`${error.message}\n${JSON.stringify(diagnostic)}`);
    }
  };
  const edit=async text=>{
    await page.locator('#markdown-editor').focus();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.insertText(text);
    await page.waitForFunction(expected=>window.desktopCodeEditor.getText()===expected,text,{timeout:10000});await page.evaluate('window.desktopEditor.flush()');
  };
  const preference=async(id,value)=>{await openSettings(page);await page.locator('#'+id).setChecked(value);await page.waitForFunction(selector=>!document.getElementById(selector).disabled,id);await closeDialogs(page);};
  const gateWorker=()=>app.evaluate(async({BrowserWindow})=>{
    const worker=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('render-host.html'));
    if(!worker)throw Error('Missing real diagram worker');
    globalThis.__previewWorker=worker;
    await worker.webContents.executeJavaScript('window.__originalRender ||= window.renderHost;window.__blocked=false;window.renderHost=async payload=>{window.__blocked=true;await new Promise(resolve=>window.__release=resolve);return window.__originalRender(payload)};undefined');
  });
  const blocked=async()=>{
    for(let index=0;index<100;index++) {
      if(await app.evaluate(async()=>globalThis.__previewWorker&&!globalThis.__previewWorker.isDestroyed()&&await globalThis.__previewWorker.webContents.executeJavaScript('Boolean(window.__blocked)')))return;
      await page.waitForTimeout(25);
    }
    throw Error('Preview did not reach the held real render worker');
  };
  try {
    await ready();await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:0});},[a,b]);
    await openFile(page);await ready();await page.locator('[data-shell-mode="split"]').click();
    await t.test('debounces typing without writing the source and waits for composition to finish',async()=>{
      await edit('# 自动更新一');assert.equal(await page.locator('#pdf').isDisabled(),true);
      await edit('# 自动更新二');await settled();assert.equal(await page.locator('#markdown-content h1').innerText(),'自动更新二');
      assert.equal(await fs.readFile(a,'utf8'),'# 初始正文');
      await page.dispatchEvent('#markdown-editor','compositionstart');
      await edit('# 输入法组字');await page.waitForTimeout(650);
      assert.equal(await page.locator('#markdown-content h1').innerText(),'自动更新二');
      await page.dispatchEvent('#markdown-editor','compositionend');await settled();
      assert.equal(await page.locator('#markdown-content h1').innerText(),'输入法组字');
    });
    const diagram=label=>`# 图表预览\n\n\`\`\`mermaid\ngraph TD\n A[${label}] --> B[结束]\n\`\`\``;
    await t.test('typing cancels a held diagram job and only the latest revision becomes exportable',async()=>{
      await edit(diagram('首个图表'));await settled();
      const initial=await page.locator('#markdown-content .diagram-block img').getAttribute('src');await gateWorker();
      await edit(diagram('过期图表'));await blocked();
      assert.equal(await page.locator('#markdown-editor').getAttribute('contenteditable'),'true');
      assert.equal(await page.locator('#open').isDisabled(),false);
      await edit(diagram('最终图表'));await settled();
      assert.equal(await app.evaluate(()=>globalThis.__previewWorker.isDestroyed()),true);
      const image=page.locator('#markdown-content .diagram-block img');
      assert.notEqual(await image.getAttribute('src'),initial);assert.ok(await image.evaluate(node=>node.naturalWidth>0));
      assert.match(await page.evaluate('window.desktopApp.state().document.markdown'),/最终图表/);
      assert.doesNotMatch(await page.locator('#markdown-content').textContent(),/过期图表/);
      assert.equal(await page.locator('#pdf').isDisabled(),false);
    });
    await t.test('switching tabs cancels an in-flight preview without allowing stale completion',async()=>{
      await gateWorker();await edit(diagram('切换前草稿'));await blocked();
      await page.locator('.tab-open',{hasText:'B.md'}).click();await ready();
      assert.equal(await page.locator('#markdown-content h1').innerText(),'B 正文');await page.waitForTimeout(650);
      assert.equal(await page.locator('#markdown-content h1').innerText(),'B 正文');
      await page.locator('.tab-open',{hasText:'A.md'}).click();await ready();await settled();
      assert.equal(await page.locator('#markdown-content .diagram-block img').count(),1);
      assert.match(await page.evaluate('window.desktopApp.state().document.markdown'),/切换前草稿/);
    });
    await t.test('a failed preview leaves the editor usable and a subsequent valid edit recovers',async()=>{
      await edit('# 无效资源\n\n![missing](missing-image.png)');
      await page.waitForFunction(()=>document.getElementById('status').textContent.includes('预览失败'));
      assert.equal(await page.locator('#markdown-editor').getAttribute('contenteditable'),'true');assert.equal(await page.locator('#pdf').isDisabled(),true);
      await edit('# 失败后恢复');await settled();assert.equal(await page.locator('#markdown-content h1').innerText(),'失败后恢复');
    });
    await t.test('a rejected source save remains visible instead of being overwritten by a background preview',async()=>{
      await edit('# 本地冲突草稿');await fs.writeFile(a,'# 外部磁盘版本');
      await page.click('#save');await ready();assert.match(await page.locator('#status').innerText(),/SAVE_CONFLICT/);
      await page.waitForTimeout(650);assert.match(await page.locator('#status').innerText(),/SAVE_CONFLICT/);
      assert.equal(await fs.readFile(a,'utf8'),'# 外部磁盘版本');assert.equal(await page.evaluate('window.desktopCodeEditor.getText()'),'# 本地冲突草稿');
    });
    let long;
    await t.test('double-click maps both directions with one-based source lines, frontmatter and fenced blocks',async()=>{
      long='---\ntitle: 映射\n---\n\n# 长文\n\n'+Array.from({length:100},(_,i)=>`## 章节 ${i}\n\n章节正文 ${i}。\n\n${i===40?'\`\`\`text\n代码第一行\n代码第二行\n\`\`\`\n\n':''}`).join('');
      await edit(long);await settled();
      const target=page.locator('#markdown-content h2').filter({hasText:/^章节 70$/});await target.scrollIntoViewIfNeeded();await target.dblclick();
      const expected=long.split('\n').findIndex(line=>line==='## 章节 70')+1;
      assert.equal(await page.evaluate('window.desktopCodeEditor.selectionLine'),expected);
      await page.click('#locate-preview');
      assert.equal(await page.locator('.search-line-target').getAttribute('data-line'),String(expected-1));
      await page.locator('.cm-scroller').click({position:{x:100,y:30}});await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
      const source=page.locator('.cm-line').filter({hasText:/^# 长文$/});await source.dblclick();
      assert.equal(await page.locator('.search-line-target').getAttribute('data-line'),'4');
    });
    await t.test('split scroll follows source lines in both directions without feedback oscillation',async()=>{
      await page.locator('.cm-scroller').evaluate(node=>{node.scrollTop=1800;});
      await page.waitForFunction(()=>Math.abs(window.desktopViewer.sourceLine()-window.desktopCodeEditor.viewportLine())<4);
      await page.locator('#reader').dispatchEvent('wheel',{deltaY:100});
      await page.locator('#reader').evaluate(node=>{node.scrollTop=4000;});
      await page.waitForFunction(()=>Math.abs(window.desktopViewer.sourceLine()-window.desktopCodeEditor.viewportLine())<4);
      const position=()=>page.evaluate(()=>[document.querySelector('.cm-scroller').scrollTop,document.getElementById('reader').scrollTop]);
      const before=await position();await page.waitForTimeout(500);const after=await position();
      assert.ok(after.every((value,i)=>Math.abs(value-before[i])<3));
      await page.screenshot({path:path.join(artifacts,'split-synchronized.png'),scale:'css'});
      await preference('scroll-sync',false);const top=await page.locator('#reader').evaluate(node=>node.scrollTop);
      await page.locator('.cm-scroller').evaluate(node=>{node.scrollTop=500;});await page.waitForTimeout(300);
      assert.equal(await page.locator('#reader').evaluate(node=>node.scrollTop),top);
      await page.screenshot({path:path.join(artifacts,'split-independent.png'),scale:'css'});
    });
    await t.test('finishing a slow render follows the latest source viewport without reversing reader interaction',async()=>{
      await preference('scroll-sync',true);
      await edit(long+'\n'+diagram('视口基线'));await settled();await gateWorker();
      await edit(long+'\n'+diagram('视口完成'));await blocked();
      await page.locator('.cm-scroller').evaluate(node=>{node.scrollTop=1800;});
      const line=await page.evaluate('window.desktopCodeEditor.viewportLine()');
      await app.evaluate(async()=>{await globalThis.__previewWorker.webContents.executeJavaScript('window.__release();undefined');});
      await settled();assert.ok(Math.abs(await page.evaluate('window.desktopViewer.sourceLine()')-line)<4);
      await gateWorker();await edit(long+'\n'+diagram('读者位置'));await blocked();
      await page.locator('#reader').dispatchEvent('wheel',{deltaY:100});await page.locator('#reader').evaluate(node=>{node.scrollTop=2300;});
      const readerLine=await page.evaluate('window.desktopViewer.sourceLine()');
      await app.evaluate(async()=>{await globalThis.__previewWorker.webContents.executeJavaScript('window.__release();undefined');});
      await settled();assert.ok(Math.abs(await page.evaluate('window.desktopViewer.sourceLine()')-readerLine)<4);
      await page.waitForFunction(()=>Math.abs(window.desktopViewer.sourceLine()-window.desktopCodeEditor.viewportLine())<4);
      await preference('scroll-sync',false);
    });
    await t.test('preview preferences persist independently of appearance and manual refresh remains available',async()=>{
      await preference('live-preview',false);await edit('# 手动预览');await page.waitForTimeout(650);
      assert.notEqual(await page.locator('#markdown-content h1').first().innerText(),'手动预览');assert.equal(await page.locator('#locate-preview').isDisabled(),true);
      await page.click('#preview-draft');await ready();assert.equal(await page.locator('#markdown-content h1').innerText(),'手动预览');
      await page.reload();await ready();
      await page.waitForFunction(()=>!window.desktopApp.state().preview.live);
      const prefs=await page.evaluate('window.desktop.preferences("get")');assert.equal(prefs.livePreview,false);assert.equal(prefs.scrollSync,false);assert.equal(prefs.appearance,'light');
      assert.equal(await page.evaluate('window.desktop.preferences("set",{livePreview:"yes"}).then(()=>false,()=>true)'),true);
      await page.locator('[data-shell-mode="split"]').click();await preference('live-preview',true);await edit('# 恢复自动预览');await settled();
      assert.equal(await page.locator('#markdown-content h1').innerText(),'恢复自动预览');
      assert.deepEqual(errors,[]);
    });
  } finally {await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:2});});await app.close();}
});
