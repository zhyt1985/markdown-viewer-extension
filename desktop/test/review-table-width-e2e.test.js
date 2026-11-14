import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import { launchDesktop,openFile} from './ui-helpers.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('six-column review table with hard breaks and inline code fits in reading and split layouts',{timeout:120000},async()=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','review-table');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-'));
  // An explicit local document is read in place. The normal suite uses synthetic
  // content and never depends on or copies a user's private review document.
  const fixture=path.join(folder,'review-table.md');
  const rows=Array.from({length:13},(_,i)=>`| ${i+1} | ReviewServiceImplementation.java 中存在需要说明的处理逻辑。 | controllers/ReviewController<br>services/ReviewServiceImplementation.java | 请给出处理措施，并说明保留原有行为的原因。 | **已响应**。使用 \`ReviewConfiguration\` 明确约束；先完成校验，再执行后续处理。<br>**保留内容**：现有记录不变，详细原因见后续章节。 | |`).join('\n');
  if(!process.env.MV_DESKTOP_WIDTH_DOCUMENT)await fs.writeFile(fixture,`# 表格宽度回归\n\n> 分支：\`feature.review_table_responsive_layout_without_horizontal_overflow\`\n\n## 1. 3.3 问题记录表\n\n| 序号 | 问题描述 | 位置 | 整改意见 | 响应情况 | 检查确认 |\n|---|---|---|---|---|---|\n${rows}\n\n## 后续说明\n\n这是生成的测试数据。\n\n- \`controllers/VeryLongReviewConfigurationControllerImplementation.java\`\n- \`POST /reviewConfiguration/checkAndUpdateConfigurationRecords\``);
  const file=process.env.MV_DESKTOP_WIDTH_DOCUMENT||fixture;
  const digest=async()=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await digest();
  const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await launchDesktop({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow(),measurements=[];
  try{
    await page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},file);
    await openFile(page);await page.waitForFunction(()=>!document.getElementById('open').disabled&&document.querySelector('#markdown-content table'));
    for(const mode of ['reading','narrow-reading','split']){
      if(mode==='narrow-reading'){
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible()).setSize(1000,760));
        await page.waitForFunction(()=>innerWidth<=1000);
      }
      if(mode==='split')await page.locator('[data-shell-mode="split"]').click();
      const geometry=await page.evaluate(()=>{
        const content=document.getElementById('markdown-content'),reader=document.getElementById('reader');
        const heading=Array.from(content.querySelectorAll('h2')).find(h=>h.textContent.includes('1. 3.3 问题记录表'));
        const block=heading?.closest('.md-block').nextElementSibling,table=block?.querySelector('table');
        if(!table)throw Error('Target review table not found after heading');
        reader.scrollTop+=heading.getBoundingClientRect().top-reader.getBoundingClientRect().top-16;
        const host=table.parentElement,rect=table.getBoundingClientRect(),bounds=content.getBoundingClientRect();
        const last=table.rows[0].cells[5].getBoundingClientRect();
        return {version:document.getElementById('app-version').textContent,contentWidth:bounds.width,tableWidth:rect.width,tableLeft:rect.left,tableRight:rect.right,contentLeft:bounds.left,contentRight:bounds.right,lastColumnRight:last.right,hostWidth:host.clientWidth,hostScroll:host.scrollWidth,readerWidth:reader.clientWidth,readerScroll:reader.scrollWidth,rows:table.tBodies[0]?.rows.length,columns:table.rows[0].cells.length,hardBreaks:table.querySelectorAll('br').length,inlineCode:table.querySelectorAll('code').length,overflow:Array.from(content.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right>bounds.right+1).slice(0,10).map(node=>({tag:node.tagName,cls:node.className,right:node.getBoundingClientRect().right,text:node.textContent.slice(0,80)}))};
      });
      measurements.push({mode,...geometry});
      await page.screenshot({path:path.join(artifacts,`${mode}.png`),scale:'css'});
      await fs.writeFile(path.join(artifacts,'measurements.json'),JSON.stringify(measurements,null,2));
      assert.equal(geometry.rows,13);assert.equal(geometry.columns,6);
      assert.ok(geometry.hardBreaks>0);assert.ok(geometry.inlineCode>0);
      assert.ok(geometry.tableWidth<=geometry.contentWidth+1,JSON.stringify(geometry));
      assert.ok(geometry.tableLeft>=geometry.contentLeft-1);
      assert.ok(geometry.tableRight<=geometry.contentRight+1);
      assert.ok(geometry.lastColumnRight<=geometry.contentRight+1);
      assert.ok(geometry.hostScroll<=geometry.hostWidth+1);
      assert.ok(geometry.readerScroll<=geometry.readerWidth+1);
    }
    assert.equal(await digest(),before,'Opening and measuring must not modify source bytes');
  }finally{await app.close();}
});
