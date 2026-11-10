import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {_electron} from 'playwright-core';
import {openFile} from './ui-helpers.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('wide tables stay inside the reading page and remain accessible after resize and preview',{timeout:120000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','table-overflow');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-'));
  const file=path.join(folder,'tables.md');
  const row=Array.from({length:16},(_,i)=>`column_${i}_unbroken_identifier_123456789`).join(' | ');
  const url='https://example.invalid/'+('long-path-without-spaces'.repeat(12));
  const code='very_long_identifier_without_breaks_'.repeat(8);
  const prose='这是一段需要在单元格内自动换行的中文说明。'.repeat(8);
  const markdown=`# 表格宽度回归\n\n| ${row} |\n| ${Array(16).fill('---').join(' | ')} |\n| ${row} |\n\n表格后的正文。\n\n| 名称 | 值 |\n| --- | --- |\n| 小表 | 42 |\n\n| 说明 | 链接 | 代码 | 状态 |\n| --- | --- | --- | --- |\n| ${prose} | [${url}](${url}) | \`${code}\` | 完整 |`;
  await fs.writeFile(file,markdown);
  const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow();
  const contained=async()=>{
    const geometry=await page.evaluate(()=>{
      const content=document.getElementById('markdown-content'),reader=document.getElementById('reader');
      return {contentWidth:content.clientWidth,contentScroll:content.scrollWidth,readerWidth:reader.clientWidth,readerScroll:reader.scrollWidth,contentRight:content.getBoundingClientRect().right,tables:Array.from(content.querySelectorAll('table'),table=>{
        const host=table.parentElement;
        return {hostWidth:host.clientWidth,hostScroll:host.scrollWidth,tableWidth:table.getBoundingClientRect().width,tableRight:table.getBoundingClientRect().right,hostRight:host.getBoundingClientRect().right};
      })};
    });
    assert.ok(geometry.contentScroll<=geometry.contentWidth+1,`正文被表格撑宽：${JSON.stringify(geometry)}`);
    assert.ok(geometry.readerScroll<=geometry.readerWidth+1,`阅读区出现整体横向溢出：${JSON.stringify(geometry)}`);
    for(const table of geometry.tables){
      assert.ok(table.hostRight<=geometry.contentRight+1);
      assert.ok(table.tableWidth<=table.hostWidth+1,`表格本身仍超出正文：${JSON.stringify(table)}`);
      assert.ok(table.tableRight<=geometry.contentRight+1);
      assert.ok(table.hostScroll<=table.hostWidth+1,`表格内容仍需横向滚动：${JSON.stringify(table)}`);
    }
  };
  try{
    await page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},file);
    await openFile(page);
    try {await page.waitForFunction(()=>!document.getElementById('open').disabled&&document.querySelectorAll('#markdown-content table').length===3,null,{timeout:10000});}
    catch(error){throw Error(`${error.message}\n${await page.evaluate(()=>JSON.stringify({status:document.getElementById('status').textContent,tables:document.querySelectorAll('#markdown-content table').length,body:document.getElementById('markdown-content').innerHTML.slice(-2000)}))}`);}
    await t.test('wide table wraps text and displays every column inside the page without horizontal scrolling',async()=>{
      await contained();
      const table=page.locator('#markdown-content table').first();
      assert.equal(await table.locator('th').count(),16);
      assert.equal(await table.locator('tbody td').last().innerText(),'column_15_unbroken_identifier_123456789');
      await page.screenshot({path:path.join(artifacts,'reading.png'),scale:'css'});
    });
    await t.test('small tables keep natural width and all three alignment modes',async()=>{
      for(const layout of ['left','center','center-full-width']){
        const geometry=await page.evaluate(layout=>{
          const content=document.getElementById('markdown-content');content.classList.remove('table-layout-left','table-layout-center','table-layout-center-full-width');content.classList.add(`table-layout-${layout}`);
          const table=content.querySelectorAll('table')[1],host=table.parentElement;
          const a=table.getBoundingClientRect(),b=host.getBoundingClientRect();return {width:a.width,available:b.width,left:a.left-b.left,right:b.right-a.right,columns:table.rows[1].cells.length};
        },layout);
        assert.equal(geometry.columns,2);
        if(layout==='center-full-width')assert.ok(Math.abs(geometry.width-geometry.available)<2);
        else {assert.ok(geometry.width<geometry.available*.8);if(layout==='left')assert.ok(Math.abs(geometry.left)<2);else assert.ok(Math.abs(geometry.left-geometry.right)<2);}
        await contained();
      }
    });
    await t.test('Chinese paragraphs, long URL and inline code wrap without losing text',async()=>{
      const tables=page.locator('#markdown-content table');
      assert.equal(await tables.nth(2).locator('a').textContent(),url);
      assert.equal(await tables.nth(2).locator('code').textContent(),code);
      await contained();
      await tables.nth(2).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'long-content.png'),scale:'css'});
    });
    await t.test('window resizing and split mode keep overflow within each table',async()=>{
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible()).setSize(1000,760));
      await page.waitForFunction(()=>innerWidth<=1000);await contained();
      await page.locator('[data-shell-mode="split"]').click();await contained();
      await page.screenshot({path:path.join(artifacts,'split.png'),scale:'css'});
    });
    await t.test('live preview rebuilds one scroll container per table without touching source bytes',async()=>{
      await page.locator('[data-shell-mode="split"]').click();
      await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\n编辑后的正文。');
      await page.evaluate('window.desktopEditor.flush()');
      await page.waitForFunction(()=>window.desktopApp.state().preview.current&&document.getElementById('markdown-content').textContent.includes('编辑后的正文'));
      assert.equal(await page.locator('#markdown-content .desktop-table-scroll').count(),3);
      assert.equal(await page.locator('.desktop-table-scroll .desktop-table-scroll').count(),0);
      await contained();assert.equal(await fs.readFile(file,'utf8'),markdown);
    });
  }finally{await app.close();}
});
