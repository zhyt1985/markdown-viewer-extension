// Local, read-only performance probe. Document contents and profiles stay under
// ignored test-results; no user document is copied into repository fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {_electron} from 'playwright-core';
import {openFile} from '../test/ui-helpers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../package.json',import.meta.url));
const file=process.env.MV_DESKTOP_PERF_DOCUMENT;
if(!file)throw Error('Set MV_DESKTOP_PERF_DOCUMENT to a local Markdown document');
const label=process.env.MV_DESKTOP_PERF_LABEL||'scroll';
if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid artifact label');
const artifacts=path.join(root,'test-results/desktop/performance',label);await fs.mkdir(artifacts,{recursive:true});
const profile=await fs.mkdtemp(path.join(artifacts,'profile-'));
const sourceHash=async()=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const before=await sourceHash(),packaged=process.env.MV_DESKTOP_EXECUTABLE;
const app=await _electron.launch({executablePath:packaged||require('electron'),args:[`--user-data-dir=${profile}`,...(packaged?[]:[path.join(root,'dist/desktop/app')])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},timeout:60000});
const page=await app.firstWindow(),results=[];
try{
  await page.waitForFunction(()=>Boolean(window.desktopShell)&&!document.getElementById('open').disabled);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:2});},file);
  const start=Date.now();await openFile(page);await page.waitForFunction(()=>!document.getElementById('open').disabled&&document.querySelector('#markdown-content h1'),null,{timeout:120000});
  const stats=await page.evaluate(()=>({version:document.getElementById('app-version').textContent,nodes:document.querySelectorAll('#markdown-content *').length,blocks:document.querySelectorAll('#markdown-content .md-block').length,tables:document.querySelectorAll('#markdown-content table').length,codeBlocks:document.querySelectorAll('#markdown-content pre').length,headings:document.querySelectorAll('#markdown-content h1,#markdown-content h2,#markdown-content h3').length,height:document.getElementById('reader').scrollHeight}));
  const loadMs=Date.now()-start;
  stats.images=await page.evaluate(()=>Array.from(document.querySelectorAll('#markdown-content img'),image=>({alt:image.alt,width:image.width,height:image.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,top:image.getBoundingClientRect().top+document.getElementById('reader').scrollTop})));
  console.log(JSON.stringify({loadMs,...stats}));
  const session=await page.context().newCDPSession(page);await session.send('Performance.enable');await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:1000});
  const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  for(const mode of (process.env.MV_DESKTOP_PERF_MODES||'reading,split').split(',')){
    await page.locator(`[data-shell-mode="${mode}"]`).click();
    if(process.env.MV_DESKTOP_PERF_CONTAIN==='1')await page.addStyleTag({content:'#reader #markdown-content > .md-block {contain:layout paint;}'});
    if(process.env.MV_DESKTOP_PERF_PAINT==='1')await page.addStyleTag({content:'#reader #markdown-content pre,#reader #markdown-content .desktop-table-scroll {contain:paint;}'});
    await page.evaluate(()=>{const reader=document.getElementById('reader');reader.scrollTop=0;});
    // Let mode/layout and programmatic source positioning settle before sampling.
    await page.waitForTimeout(400);
    if(process.env.MV_DESKTOP_PERF_TRACE==='1')await session.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,cc',transferMode:'ReturnAsStream'});
    const begin=await metrics();await session.send('Profiler.start');
    const frames=await page.evaluate(async()=>{
      const reader=document.getElementById('reader'),gaps=[],longTasks=[];
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask'});
      let previous=await new Promise(resolve=>requestAnimationFrame(resolve));
      for(let index=0;index<240;index++){
        if(index===120)reader.scrollTop=reader.scrollHeight*.55;
        else reader.scrollTop+=160;
        const now=await new Promise(resolve=>requestAnimationFrame(resolve));gaps.push(now-previous);previous=now;
      }
      observer.disconnect();const ordered=[...gaps].sort((a,b)=>a-b);
      return {p50:ordered[Math.floor(ordered.length*.5)],p95:ordered[Math.floor(ordered.length*.95)],p99:ordered[Math.floor(ordered.length*.99)],max:ordered.at(-1),over34ms:gaps.filter(x=>x>34).length,slowFrames:gaps.map((gap,index)=>({gap,index})).filter(x=>x.gap>34),longTasks,scrollTop:reader.scrollTop};
    });
    const {profile:cpu}=await session.send('Profiler.stop'),end=await metrics();
    if(process.env.MV_DESKTOP_PERF_TRACE==='1'){
      const done=new Promise(resolve=>session.once('Tracing.tracingComplete',resolve));await session.send('Tracing.end');const {stream}=await done;
      let trace='';while(true){const chunk=await session.send('IO.read',{handle:stream});trace+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data;if(chunk.eof)break;}await session.send('IO.close',{handle:stream});
      await fs.writeFile(path.join(artifacts,`${mode}.trace.json`),trace);
      console.log(JSON.stringify({mode,traceTop:JSON.parse(trace).traceEvents.filter(event=>event.dur&&event.ph==='X').sort((a,b)=>b.dur-a.dur).slice(0,15).map(event=>({name:event.name,ms:event.dur/1000,args:event.args}))}));
    }
    await fs.writeFile(path.join(artifacts,`${mode}.cpuprofile`),JSON.stringify(cpu));
    const costs={};for(const node of cpu.nodes){const name=node.callFrame.functionName||'(anonymous)';costs[name]=(costs[name]||0)+(node.hitCount||0);}
    const top=Object.entries(costs).sort((a,b)=>b[1]-a[1]).slice(0,12);
    const duration={};for(const name of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'])duration[name]=end[name]-begin[name];
    const result={mode,...frames,...duration,top};results.push(result);console.log(JSON.stringify(result));
  }
  const mapping=await page.evaluate(()=>{
    const original=Element.prototype.getBoundingClientRect;let reads=0;
    Element.prototype.getBoundingClientRect=function(){reads++;return original.call(this);};
    const started=performance.now();try{for(let index=0;index<50;index++)window.desktopViewer.sourceLine();return {calls:50,geometryReads:reads,durationMs:performance.now()-started};}
    finally{Element.prototype.getBoundingClientRect=original;}
  });
  if(await sourceHash()!==before)throw Error('Source bytes changed');
  await fs.writeFile(path.join(artifacts,'results.json'),JSON.stringify({loadMs,...stats,results,mapping,sourceUnchanged:true},null,2));console.log(JSON.stringify({mapping}));
}finally{await app.close();}
