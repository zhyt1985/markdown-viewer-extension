import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import { launchDesktop,openFile} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('large-document scroll lookup stays logarithmic and display images retain original assets',{timeout:120000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','scroll-performance');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-')),file=path.join(folder,'large.md');
  const label='Deliberately wide diagram label to test display image resampling while retaining original export quality';
  const diagram='```mermaid\ngraph LR\n'+['A','B','C','D'].map(id=>`${id}[${label}]`).join(' --> ')+'\n```';
  const body='# 性能回归\n\n'+Array.from({length:400},(_,i)=>`## 段落 ${i}\n\n正文 ${i}。\n\n`).join('')+diagram;
  await fs.writeFile(file,body);const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await launchDesktop({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow();
  try{
    await page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},file);
    await openFile(page);await page.waitForFunction(()=>!document.getElementById('open').disabled&&Boolean(document.querySelector('#markdown-content img')));
    await t.test('live binary positions match a full scan without walking every block',async()=>{
      for(const fraction of [0,.25,.75,.98]){
        const result=await page.evaluate(fraction=>{
          const reader=document.getElementById('reader');reader.scrollTop=reader.scrollHeight*fraction;
          const top=reader.getBoundingClientRect().top+12,blocks=Array.from(document.querySelectorAll('#markdown-content .md-block[data-line]')).filter(block=>block.getBoundingClientRect().height>0);
          const preceding=blocks.filter(block=>block.getBoundingClientRect().top<=top),block=preceding.at(-1)||blocks[0],rect=block.getBoundingClientRect();
          const expected=Number(block.dataset.line)+1+Math.max(0,Math.min(.999,(top-rect.top)/Math.max(1,rect.height)))*Number(block.dataset.lineCount||1);
          const original=Element.prototype.getBoundingClientRect;let reads=0;
          Element.prototype.getBoundingClientRect=function(){reads++;return original.call(this);};
          try{let actual;for(let index=0;index<50;index++)actual=window.desktopViewer.sourceLine();return {actual,expected,reads,blocks:blocks.length};}
          finally{Element.prototype.getBoundingClientRect=original;}
        },fraction);
        assert.ok(Math.abs(result.actual-result.expected)<.01);
        assert.ok(result.reads<=50*(Math.ceil(Math.log2(result.blocks))+4),JSON.stringify(result));
      }
    });
    await t.test('unchanged editor text is not serialized again for scroll state checks',async()=>{
      const reads=await page.evaluate(()=>{
        const editor=window.desktopCodeEditor,descriptor=Object.getOwnPropertyDescriptor(editor,'value');let reads=0;
        Object.defineProperty(editor,'value',{...descriptor,get(){reads++;return descriptor.get.call(this);}});
        try{window.desktopApp.state();reads=0;for(let i=0;i<100;i++)window.desktopApp.state();return reads;}
        finally{Object.defineProperty(editor,'value',descriptor);}
      });assert.equal(reads,0);
      await page.locator('[data-shell-mode="split"]').click();await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n修改后必须立即标脏');
      assert.equal(await page.evaluate(()=>window.desktopApp.state().dirty),true);
      assert.equal(await page.evaluate(()=>window.desktopApp.state().preview.current),false);
      await page.evaluate('window.desktopEditor.flush()');await page.waitForFunction(()=>window.desktopApp.state().preview.current);
    });
    await t.test('screen image is bounded while its full-resolution original survives until document disposal',async()=>{
      const result=await page.evaluate(async()=>{
        const image=document.querySelector('#markdown-content .diagram-block img'),original=window.desktopViewer.originalImageSource(image),source=new Image();source.src=original;await source.decode();
        return {display:image.naturalWidth,source:source.naturalWidth,url:image.src,original:original.startsWith('data:image/png'),ratio:image.style.aspectRatio};
      });
      assert.ok(result.original);assert.ok(result.url.startsWith('blob:'),'Expected a bounded display bitmap');assert.ok(result.source>result.display*1.5);assert.ok(result.ratio);
      await page.locator('[data-shell-mode="reading"]').click();await page.locator('#markdown-content .diagram-block img').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'screen-diagram.png'),scale:'css'});
      const disposed=await page.evaluate(async url=>{window.desktopViewer.clear();try{await fetch(url);return false;}catch{return true;}},result.url);assert.equal(disposed,true);
      assert.equal(await fs.readFile(file,'utf8'),body);
    });
  }finally{await app.close();}
});
