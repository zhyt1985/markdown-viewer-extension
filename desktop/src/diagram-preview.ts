import { bindUi, bindUiAttribute, ui } from './desktop-ui';

function intrinsicSVG(source:string) {
  const parsed=new DOMParser().parseFromString(source,'image/svg+xml'),svg=parsed.documentElement;
  if(svg.localName!=='svg')return source;
  const box=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  // Renderer SVGs commonly use width="100%". Give the image a stable intrinsic
  // size from the viewBox, so 100% and fit describe the actual drawing size.
  if(box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0){
    svg.setAttribute('width',String(box[2]));svg.setAttribute('height',String(box[3]));
  }
  return new XMLSerializer().serializeToString(svg);
}
export function setupDiagramPreview(containers:HTMLElement[],resolve:(image:HTMLImageElement)=>{source:string;vector:boolean}) {
  const dialog=document.getElementById('diagram-dialog') as HTMLDialogElement;
  const viewport=document.getElementById('diagram-viewport')!;
  const image=document.getElementById('diagram-detail') as HTMLImageElement;
  const label=document.getElementById('diagram-zoom')!;
  const status=document.getElementById('diagram-preview-status')!;
  let scale=1,panX=0,panY=0,fitted=true,opener:HTMLElement|null=null,ownedURL:string|null=null;
  let drag:{id:number;x:number;y:number;panX:number;panY:number}|null=null;
  const paint=()=>{
    image.style.transform=`translate(${(viewport.clientWidth-image.naturalWidth*scale)/2+panX}px,${(viewport.clientHeight-image.naturalHeight*scale)/2+panY}px) scale(${scale})`;
    label.textContent=`${Math.round(scale*100)}%`;
  };
  const fit=()=>{if(!image.naturalWidth)return;scale=Math.min((viewport.clientWidth-64)/image.naturalWidth,(viewport.clientHeight-64)/image.naturalHeight,1);panX=panY=0;fitted=true;paint();};
  const zoom=(next:number,x=viewport.clientWidth/2,y=viewport.clientHeight/2)=>{
    if(!image.naturalWidth)return;
    next=Math.max(.01,Math.min(8,next));const ratio=next/scale;
    const left=(viewport.clientWidth-image.naturalWidth*scale)/2+panX,top=(viewport.clientHeight-image.naturalHeight*scale)/2+panY;
    panX=x-(x-left)*ratio-(viewport.clientWidth-image.naturalWidth*next)/2;
    panY=y-(y-top)*ratio-(viewport.clientHeight-image.naturalHeight*next)/2;
    scale=next;fitted=false;paint();
  };
  const close=()=>{if(dialog.open)dialog.close();};
  dialog.addEventListener('close',()=>{
    image.onload=image.onerror=null;image.removeAttribute('src');image.style.transform='';
    if(ownedURL)URL.revokeObjectURL(ownedURL);ownedURL=null;
    if(drag&&viewport.hasPointerCapture(drag.id))viewport.releasePointerCapture(drag.id);drag=null;
    viewport.classList.remove('dragging');if(opener?.isConnected)opener.focus({preventScroll:true});opener=null;
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.getElementById('diagram-close')!.addEventListener('click',close);
  document.getElementById('diagram-fit')!.addEventListener('click',fit);
  document.getElementById('diagram-actual')!.addEventListener('click',()=>{panX=panY=0;zoom(1);panX=panY=0;paint();});
  document.getElementById('diagram-zoom-in')!.addEventListener('click',()=>zoom(scale*1.25));
  document.getElementById('diagram-zoom-out')!.addEventListener('click',()=>zoom(scale/1.25));
  viewport.addEventListener('wheel',event=>{event.preventDefault();const rect=viewport.getBoundingClientRect();zoom(scale*(event.deltaY<0?1.15:1/1.15),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
  viewport.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,panX,panY};viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');});
  viewport.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;panX=drag.panX+event.clientX-drag.x;panY=drag.panY+event.clientY-drag.y;paint();});
  const endDrag=()=>{drag=null;viewport.classList.remove('dragging');};
  viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
  viewport.addEventListener('lostpointercapture',endDrag);
  dialog.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.25);}
    else if(event.key==='-'){event.preventDefault();zoom(scale/1.25);}
    else if(event.key==='0'){event.preventDefault();fit();}
    else if(event.key.startsWith('Arrow')){event.preventDefault();panX+=event.key==='ArrowLeft'?60:event.key==='ArrowRight'?-60:0;panY+=event.key==='ArrowUp'?60:event.key==='ArrowDown'?-60:0;fitted=false;paint();}
  });
  new ResizeObserver(()=>{if(dialog.open&&fitted)fit();}).observe(viewport);
  function openPreview(event: MouseEvent) {
    const target=event.target as HTMLElement,block=target.closest('.diagram-block');
    if(!block||(!target.matches('img')&&!target.closest('.desktop-diagram-open')))return;
    const source=block.querySelector('img');if(!source)return;
    event.preventDefault();event.stopPropagation();close();
    opener=target.closest('button') as HTMLElement||block.querySelector('.desktop-diagram-open');
    const isImage = block.classList.contains('desktop-image-file');
    bindUi(document.getElementById('diagram-title')!, isImage ? '图片预览' : '图表预览');
    bindUiAttribute(document.getElementById('diagram-zoom-in')!, 'aria-label', isImage ? '放大图片' : '放大图表');
    bindUiAttribute(document.getElementById('diagram-zoom-out')!, 'aria-label', isImage ? '缩小图片' : '缩小图表');
    bindUiAttribute(document.getElementById('diagram-close')!, 'aria-label', isImage ? '关闭图片预览' : '关闭图表预览');
    bindUiAttribute(viewport, 'aria-label', isImage ? '图片视图，可滚轮缩放和拖动' : '图表视图，可滚轮缩放和拖动');
    const asset=resolve(source);ownedURL=asset.vector?URL.createObjectURL(new Blob([intrinsicSVG(asset.source)],{type:'image/svg+xml'})):null;
    bindUi(status, asset.vector ? "矢量图 · 可放大查看细节" : "原始清晰度图像");
    image.alt=source.alt||ui("图表");image.style.opacity='0';bindUi(label, "加载中…");
    image.onload=()=>{
      if(!dialog.open)return;
      image.style.width=`${image.naturalWidth}px`;image.style.height=`${image.naturalHeight}px`;
      image.style.opacity='1';fit();
    };
    image.onerror=()=>{bindUi(status, isImage ? "图片无法加载：{0}" : "图表加载失败，请关闭后重试。", source.alt);};
    image.src=ownedURL||asset.source;dialog.showModal();document.getElementById('diagram-close')!.focus();
  }
  for (const container of containers) container.addEventListener('click', openPreview);
  return {
    close,
    decorate(){
      const blocks = containers.flatMap(container => Array.from(container.querySelectorAll<HTMLElement>('.diagram-block')));
      for(const block of blocks){
        const source=block.querySelector('img');if(!source||block.querySelector('.desktop-diagram-open'))continue;
        const isImage = block.classList.contains('desktop-image-file');
        bindUiAttribute(source, "title", isImage ? "点击放大查看图片" : "点击放大查看图表");source.classList.add('desktop-zoomable');
        const button=document.createElement('button');button.type='button';button.className='desktop-diagram-open shell-ui';bindUi(button, "放大查看");bindUiAttribute(button, 'aria-label', isImage ? "放大查看图片" : "放大查看图表");block.append(button);
      }
    },
  };
}
