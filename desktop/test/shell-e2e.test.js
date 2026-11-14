import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { launchDesktop, openFile, openSettings, closeDialogs, selectNav } from './ui-helpers.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require = createRequire(new URL('../package.json',import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root,'desktop/app-manifest.json'),'utf8'));
test('formal Alpha identity, approved shell, keyboard and independent appearance run with real services', { timeout:120000 }, async t => {
  const artifacts = path.join(root,'test-results/desktop',process.env.MV_DESKTOP_EXECUTABLE?'packaged':'development','formal-shell');
  await fs.mkdir(artifacts,{recursive:true}); const folder = await fs.mkdtemp(path.join(artifacts,'run-'));
  const file = path.join(folder,'正式界面 验证.md');
  await fs.writeFile(file,'# 正式界面验证\n\n这是明确标记的自动化测试文档。\n\n'+Array.from({length:80},(_,i)=>`## 章节 ${i+1}\n\n用于验证独立滚动、目录和界面外观。\n\n`).join(''));
  const packaged=process.env.MV_DESKTOP_EXECUTABLE;
  const app = await launchDesktop({ executablePath:packaged || require('electron'), args:[`--user-data-dir=${path.join(folder,'profile')}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])], env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}, timeout:60000 });
  try {
    const page=await app.firstWindow(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    const ready=()=>page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
    await ready();
    await t.test('uses an independent app version and keeps low-frequency controls in settings',async()=>{
      const info=await page.evaluate('window.desktop.appInfo()');
      assert.equal(info.name,'documd-desktop'); assert.equal(info.appId,manifest.appId); assert.equal(info.version,manifest.version); assert.equal(info.designVersion,'1.0');
      assert.doesNotMatch(await page.title(),/Prototype|原型/);
      assert.equal(await page.locator('#welcome').isVisible(),true);
      assert.equal(await page.locator('#locale').isVisible(),false); assert.equal(await page.locator('#clear-cache').isVisible(),false);
      assert.equal(await page.evaluate('window.desktop.preferences("set",{appearance:"dark",path:"C:/"}).then(()=>false,()=>true)'),true);
      await page.screenshot({path:path.join(artifacts,'welcome.png'),scale:'css'});
    });
    await app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},file);
    await openFile(page); await ready();
    await t.test('provides a real document surface, directory jumps and independent source/preview modes',async()=>{
      assert.equal(await page.locator('#markdown-content h1').innerText(),'正式界面验证');
      assert.equal(await page.locator('#outline-list button').count(),81);
      await page.locator('#outline-list button').nth(30).click();
      assert.ok(await page.evaluate('document.getElementById("reader").scrollTop')>1000);
      assert.equal(await page.evaluate('window.scrollY'),0);
      await page.locator('[data-shell-mode="split"]').click(); assert.equal(await page.locator('#markdown-editor').isVisible(),true);
      await page.locator('[data-shell-mode="source"]').click(); assert.equal(await page.locator('#reader').isVisible(),false);
      await page.locator('[data-shell-mode="reading"]').click(); assert.equal(await page.locator('#markdown-editor').isVisible(),false);
      assert.equal(await page.locator('#inspector').isVisible(),true,'reading mode restores the docked outline');
      await page.evaluate('document.getElementById("reader").scrollTop=0');
      await page.screenshot({path:path.join(artifacts,'reading.png'),scale:'css'});
      await page.keyboard.press('Control+k'); await page.fill('#quick-query','正式界面'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await ready();
      assert.equal(await page.locator('.document-tab').count(),1);
      await selectNav(page,'recent'); assert.equal(await page.locator('.recent-open').count(),1); await selectNav(page,'files');
    });
    await t.test('document theme changes do not recolor or resize the application shell',async()=>{
      const chrome=()=>page.evaluate(()=>{const header=document.getElementById('app-header');const style=getComputedStyle(header);return {background:style.backgroundColor,color:style.color,font:style.fontFamily,height:header.getBoundingClientRect().height};});
      const before=await chrome();
      await page.evaluate('globalThis.platform.settings.set("themeId","midnight")'); await page.locator('.tab-open').click(); await ready();
      assert.equal(await page.evaluate('document.documentElement.classList.contains("dark")'),true);
      assert.deepEqual(await chrome(),before);
      assert.equal(await page.locator('#desktop-app').getAttribute('data-appearance'),'light');
      await openSettings(page); await page.selectOption('#appearance','dark'); await page.waitForFunction(()=>document.getElementById('desktop-app').dataset.appearance==='dark');
      await closeDialogs(page); assert.notDeepEqual(await chrome(),before);
      await page.screenshot({path:path.join(artifacts,'reading-dark.png'),scale:'css'});
      await page.reload(); await ready(); await page.waitForFunction(()=>document.getElementById('desktop-app').dataset.appearance==='dark');
      assert.equal(await page.locator('#markdown-content h1').innerText(),'正式界面验证');
    });
    await t.test('settings/export dialogs retain focus and the primary actions fit the minimum window',async()=>{
      await openSettings(page);
      for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate('document.getElementById("settings-dialog").contains(document.activeElement)'),true);}
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate('document.activeElement.id'),'settings-open');
      await page.click('#export-open'); assert.equal(await page.locator('#export-source').innerText(),'正式界面 验证.md'); await page.keyboard.press('Escape');
      for(const width of [1280,1024,960]){
        await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setContentSize(value,740),width);
        await page.waitForFunction(expected=>Math.abs(innerWidth-expected)<=2,width,{timeout:3000}).catch(async error=>{throw Error(`${error.message}; expected ${width}, actual ${await page.evaluate('innerWidth')}, native ${JSON.stringify(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).getContentSize()))}`);});
        const fits=await page.evaluate(()=>{const toolbar=document.getElementById('desktop-toolbar');return [...toolbar.querySelectorAll('button')].filter(node=>node.getBoundingClientRect().width).every(node=>node.getBoundingClientRect().right<=innerWidth)&&document.documentElement.scrollWidth===innerWidth;});
        assert.equal(fits,true,`primary controls clipped at ${width}`);
      }
      await page.screenshot({path:path.join(artifacts,'minimum-window.png'),scale:'css'});
      assert.deepEqual(errors,[]);
    });
  } finally { await app.close(); }
});
