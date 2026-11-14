import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import { launchDesktop,openFile,openSettings,closeDialogs} from './ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
test('bilingual reading fonts persist and full-resolution diagram preview zooms without changing the document',{timeout:150000},async t=>{
  const artifacts=path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','reading-font-diagram');
  await fs.mkdir(artifacts,{recursive:true});const folder=await fs.mkdtemp(path.join(artifacts,'run-')),file=path.join(folder,'reading.md');
  const label='Wide diagram label for readable full resolution zoom with original SVG detail';
  const markdown='# 中英文阅读与图表\n\n中文阅读示例，字体清晰易读。\n\nEnglish reading example. ABC 0123456789.\n\n`const value = 123;`\n\n```mermaid\ngraph LR\n'+['A','B','C','D'].map(id=>`${id}[${label}]`).join(' --> ')+'\n```\n\n## 后续内容\n\n正文继续保留。';
  await fs.writeFile(file,markdown);const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app=await launchDesktop({executablePath:packaged||require('electron'),args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const actualFonts=async selector=>{const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts.map(font=>font.familyName);};
  const applyFonts=async()=>{await page.click('#reader-font-apply');await page.waitForFunction(()=>!document.getElementById('reader-font-apply').disabled&&document.getElementById('reader-font-status').textContent.includes('已保存'));};
  try{
    await ready();await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},file);
    await openFile(page);await ready();
    await t.test('default uses clear Chinese sans-serif and independent Latin and code faces',async()=>{
      const chinese=await actualFonts('#markdown-content > .md-block:nth-child(2) p');
      const english=await actualFonts('#markdown-content > .md-block:nth-child(3) p');
      const cjkDefault = process.platform === 'win32' ? /Microsoft YaHei/i : /Microsoft YaHei|PingFang|Noto Sans|Source Han Sans/i;
      const latinDefault = process.platform === 'win32' ? /Segoe UI/i : /Segoe UI|Arial|DejaVu Sans|Liberation Sans|Noto Sans/i;
      assert.ok(chinese.some(name=>cjkDefault.test(name)),JSON.stringify(chinese));
      assert.ok(english.some(name=>latinDefault.test(name)),JSON.stringify(english));
      assert.equal(await page.locator('#markdown-content').evaluate(node=>getComputedStyle(node).fontSize),'16px');
      await page.screenshot({path:path.join(artifacts,'reading-default.png'),scale:'css'});
    });
    await t.test('lists real local fonts and keeps Chinese separate even when the Latin font supports Chinese',async()=>{
      await openSettings(page);await page.click('#reader-font-load');
      await page.waitForFunction(()=>!document.getElementById('reader-font-load').disabled);
      assert.ok(await page.locator('#reader-font-families option').count()>10,await page.locator('#reader-font-status').innerText());
      await page.fill('#reader-font-cjk','SimSun');await page.fill('#reader-font-latin','Microsoft YaHei');await page.fill('#reader-font-mono','Courier New');
      await page.fill('#reader-font-size','18');await page.fill('#reader-font-line-height','2');await applyFonts();
      await page.screenshot({path:path.join(artifacts,'font-settings.png'),scale:'css'});await closeDialogs(page);
      const chinese=await actualFonts('#markdown-content > .md-block:nth-child(2) p'),english=await actualFonts('#markdown-content > .md-block:nth-child(3) p'),code=await actualFonts('#markdown-content > .md-block:nth-child(4) code');
      assert.ok(chinese.some(name=>/SimSun/i.test(name)),JSON.stringify(chinese));
      assert.ok(english.some(name=>/Microsoft YaHei/i.test(name)),JSON.stringify(english));
      assert.ok(code.some(name=>/Courier New/i.test(name)),JSON.stringify(code));
    });
    await t.test('persists after reload, rejects malformed preferences and restores recommended fonts',async()=>{
      await page.reload();await ready();assert.equal(await page.locator('#markdown-content').evaluate(node=>getComputedStyle(node).fontSize),'18px');
      const saved=await page.evaluate(()=>window.desktop.preferences('get'));
      assert.equal(saved.readingFont.cjk,'SimSun');assert.equal(saved.readingFont.latin,'Microsoft YaHei');
      assert.equal(await page.evaluate(font=>window.desktop.preferences('set',{readingFont:{...font,size:100}}).then(()=>false,()=>true),saved.readingFont),true);
      assert.equal(await page.evaluate(font=>window.desktop.preferences('set',{readingFont:{...font,cjk:'font;url(https://example.invalid)'}}).then(()=>false,()=>true),saved.readingFont),true);
      await openSettings(page);await page.click('#reader-font-reset');await applyFonts();await closeDialogs(page);
      assert.equal(await page.locator('#markdown-content').evaluate(node=>getComputedStyle(node).fontSize),'16px');
    });
    await t.test('opens original SVG, zooms by buttons and wheel, pans and restores focus on Escape',async()=>{
      const button=page.locator('.desktop-diagram-open').first();await button.click();await page.waitForFunction(()=>/^\d+%$/.test(document.getElementById('diagram-zoom').textContent));
      assert.equal(await page.locator('#diagram-dialog').isVisible(),true);
      const fits=await page.evaluate(()=>{const a=document.getElementById('diagram-detail').getBoundingClientRect(),b=document.getElementById('diagram-viewport').getBoundingClientRect();return a.left>=b.left-1&&a.top>=b.top-1&&a.right<=b.right+1&&a.bottom<=b.bottom+1;});assert.equal(fits,true);
      const source=await page.locator('#diagram-detail').getAttribute('src');
      assert.equal(await page.evaluate(async url=>(await fetch(url)).headers.get('content-type'),source),'image/svg+xml');
      const initial=parseInt(await page.locator('#diagram-zoom').innerText());await page.click('#diagram-zoom-in');assert.ok(parseInt(await page.locator('#diagram-zoom').innerText())>initial);
      await page.click('#diagram-actual');assert.equal(await page.locator('#diagram-zoom').innerText(),'100%');
      assert.equal(await page.locator('#diagram-detail').evaluate(image=>Math.abs(image.getBoundingClientRect().width-image.naturalWidth)<1),true);
      const viewport=page.locator('#diagram-viewport'),rect=await viewport.boundingBox();await page.mouse.move(rect.x+200,rect.y+150);await page.mouse.wheel(0,-120);
      await page.waitForFunction(()=>parseInt(document.getElementById('diagram-zoom').textContent)>100);
      const before=await page.locator('#diagram-detail').getAttribute('style');
      await page.mouse.move(rect.x+200,rect.y+150);await page.mouse.down();await page.mouse.move(rect.x+280,rect.y+210,{steps:4});await page.mouse.up();
      assert.notEqual(await page.locator('#diagram-detail').getAttribute('style'),before);
      await page.screenshot({path:path.join(artifacts,'diagram-zoom.png'),scale:'css'});
      await page.keyboard.press('0');await page.keyboard.press('Escape');assert.equal(await page.locator('#diagram-dialog').isVisible(),false);
      await page.waitForFunction(()=>!document.getElementById('diagram-detail').hasAttribute('src')
        && document.activeElement.classList.contains('desktop-diagram-open'));
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('desktop-diagram-open')),true);
      assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},source),true);
    });
    await t.test('clicking the image opens preview and document replacement closes it safely',async()=>{
      await page.locator('#markdown-content .diagram-block img').first().click();await page.waitForFunction(()=>document.getElementById('diagram-dialog').open);
      await page.keyboard.press('Escape');await page.locator('[data-shell-mode="split"]').click();
      await page.locator('#markdown-editor').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n新增编辑。');await page.evaluate('window.desktopEditor.flush()');
      await page.waitForFunction(()=>window.desktopApp.state().preview.current);
      await page.locator('.desktop-diagram-open').click();await page.evaluate(()=>window.desktopViewer.clear());
      assert.equal(await page.locator('#diagram-dialog').isVisible(),false);assert.equal(await fs.readFile(file,'utf8'),markdown);assert.deepEqual(errors,[]);
    });
  }finally{await app.close();}
});
