let request = null;
let tabItems = [];
let activeId = null;
const workspaceViews = new Map();
let opening = true;
let booting = true;
let searchId = null;
let recentGeneration = 0;
let exporting = false;
let exportPromise = null;
let lastTask = null;
let editState = null;
let editQueue = Promise.resolve();
let editTimer;
let previewTimer;
let previewRun = Promise.resolve();
let previewRunning = false;
let previewGeneration = 0;
let attemptedGeneration = -1;
let livePreview = true;
let scrollSync = true;
let readerInteraction = 0;
let externalDraining = false;
const openWarnings = [];
let visits=[],visitIndex=-1;
let book=null,bookEntries=[],bookLoadedId=null,bookEpoch=0,bookChosen=-1;
const diskChanges = new Map();
const shownRecoveries = new Set();
const editor = window.desktopCodeEditor;
const normalized = text => text.replace(/\r\n?/g, '\n');
let pendingRevision=-1, pendingMarkdown=null, pendingResult=false;
function editorPending() {
  if(!editState)return false;
  if(pendingRevision!==editor.revision||pendingMarkdown!==editState.markdown) {
    pendingResult=editor.value!==normalized(editState.markdown);
    pendingRevision=editor.revision;pendingMarkdown=editState.markdown;
  }
  return pendingResult;
}
const editorDirty = () => Boolean(editState?.dirty || editorPending());
const status = document.getElementById('status');
const exportButtons = ['docx', 'pdf'].map(id => document.getElementById(id));
function controls() {
  const busy = opening || booting;
  document.getElementById('open').disabled = busy;
  document.getElementById('nav-back').disabled=busy||visitIndex<=0;
  document.getElementById('nav-forward').disabled=busy||visitIndex>=visits.length-1;
  document.getElementById('open-summary').disabled=busy||!editState||editState.untitled;
  document.getElementById('new-document').disabled = busy || tabItems.length>=32;
  document.getElementById('open-workspace').disabled = busy;
  for (const button of document.querySelectorAll('.tab-open, .tab-close, .tree-dir, .tree-file[data-supported="true"], .workspace-refresh, .workspace-close, .recent-open, .search-result')) button.disabled = busy;
  for (const button of exportButtons) button.disabled = busy || exporting || !request || editorPending() || editState?.documentVersion !== request?.documentVersion;
  document.getElementById('cancel-export').disabled = !exporting;
  document.getElementById('clear-recent').disabled = busy;
  document.getElementById('search-start').disabled = busy || workspaceViews.size === 0 || Boolean(searchId);
  document.getElementById('search-cancel').disabled = !searchId;
  for (const id of ['edit-toggle', 'preview-draft', 'save-as', 'reload-file']) document.getElementById(id).disabled = busy || !editState;
  document.getElementById('reload-file').disabled = busy || !editState || editState.untitled;
  document.getElementById('save').disabled = busy || !editState || (!editState.untitled&&!editorDirty());
  editor.disabled = busy || !editState;
  document.getElementById('locate-preview').disabled = busy || !matchedPreview();
  document.getElementById('locate-source').disabled = busy || !matchedPreview();
  document.getElementById('preview-draft').textContent = previewRunning ? '正在更新…' : '更新预览';
  document.dispatchEvent(new Event('desktop:changed'));
  syncBook();
}
function matchedPreview() {
  return Boolean(request && editState && request.documentId === editState.documentId
    && request.documentVersion === editState.documentVersion && !editorPending() && !previewRunning);
}
function cancelPreview() {
  clearTimeout(previewTimer); previewGeneration++;
  window.desktopViewer.cancelPreview();
  void window.desktop.cancelPreview().catch(error => console.error('Preview cancellation failed',error));
}
function schedulePreview(delay=450) {
  clearTimeout(previewTimer);
  if (!livePreview || opening || booting || !editState || editor.composing || attemptedGeneration === previewGeneration) return;
  previewTimer = setTimeout(() => { void updatePreview(); },delay);
}
function updatePreview() {
  if (opening || booting || !editState || previewRunning || editor.composing) return previewRun;
  const generation=previewGeneration;
  previewRunning=true; request=null; controls();
  previewRun=(async()=>{
    await flushEditor();
    if (opening || generation !== previewGeneration || editor.composing) return;
    const selected={...editState}; attemptedGeneration=generation;
    const current=()=>!opening && generation === previewGeneration && editState?.documentId===selected.documentId
      && editState?.documentVersion===selected.documentVersion && !editorPending();
    const reader=document.getElementById('reader');
    const interaction=readerInteraction;
    const anchor=scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && document.getElementById('editor-pane').contains(document.activeElement)
      ? editor.viewportLine() : window.desktopViewer.sourceLine();
    const top=reader.scrollTop;
    status.textContent='正在更新预览，仍可继续编辑…';
    await window.desktopViewer.snapshotDom(selected);
    if(!current())return;
    await waitForImages();
    if(!current())return;
    const diagnostics=window.desktopViewer.diagnostics();
    if(diagnostics.length)throw Error(`渲染诊断：${JSON.stringify(diagnostics)}`);
    const latestAnchor=readerInteraction!==interaction ? window.desktopViewer.sourceLine()
      : scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && document.getElementById('editor-pane').contains(document.activeElement)
        ? editor.viewportLine() : anchor;
    window.desktopViewer.finishPreview(latestAnchor,top);
    if(readerInteraction!==interaction && scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && latestAnchor!==null) {
      scrollOwner='preview';scrollUntil=performance.now()+180;editor.revealLine(latestAnchor);
    }
    request=selected;
    status.textContent='预览已更新 · 可以导出 Word / PDF';
    document.dispatchEvent(new Event('desktop:rendered'));
  })().catch(error=>{
    if (!opening && generation===previewGeneration) { attemptedGeneration=generation; status.textContent=`预览失败：${error.message || error}；可修改后重试或手动更新。`; }
  }).finally(()=>{
    previewRunning=false;controls();fileStatus();schedulePreview();
  });
  return previewRun;
}
function fileStatus() {
  document.getElementById('file-status').textContent = editState && diskChanges.has(editState.documentId)
    ? `磁盘文件有变化${diskChanges.get(editState.documentId)?.error ? '或暂不可用' : ''}。${editorDirty() ? '编辑稿已保留；请另存为，或重新载入磁盘并放弃编辑。' : '可重新载入；自动刷新关闭时保留当前内容。'}`
    : editState?.untitled ? '未命名文档尚未保存到文件。相对图片和本机资源将在首次保存后解析。' : editorDirty() ? '有未保存的修改。' : '';
  if (editState?.draftError) document.getElementById('file-status').textContent += ` 草稿暂存失败：${editState.draftError}。请立即保存或另存为。`;
  else if (editState?.recovered) document.getElementById('file-status').textContent += ' 已恢复本地草稿，尚未保存到源文件。';
}
async function flushEditor() {
  clearTimeout(editTimer);
  editQueue = editQueue.catch(() => {}).then(async () => {
    while (editorPending()) {
      const selected = await window.desktop.updateDraft({ documentId: editState.documentId, revision: editState.revision, markdown: editor.value });
      editState = selected; updateTabs(selected.tabs, selected.documentId); fileStatus(); controls();
    }
    setTimeout(() => { void refreshChangedFile(); }, 0);
  });
  return editQueue;
}
window.desktopEditor = { flush: flushEditor };
document.addEventListener('desktop:editor-input', () => {
  cancelPreview(); request=null;
  status.textContent = livePreview ? '源码已修改，等待更新预览…' : '源码已修改，点击“更新预览”后可导出。';
  controls(); fileStatus();
  const selected = document.querySelector('.tab-open[aria-selected="true"]');
  if (selected && editState) selected.textContent = `${tabItems.find(item => item.documentId === editState.documentId)?.filename || ''} *`;
  clearTimeout(editTimer); editTimer = setTimeout(() => { void flushEditor().catch(error => { status.textContent = `编辑稿同步失败：${error.message}`; }); }, 150);
  schedulePreview();
});
document.addEventListener('desktop:editor-composition',()=>{if(editor.composing)cancelPreview();else {schedulePreview();void drainExternalOpens();}});
document.getElementById('preview-draft').addEventListener('click', () => { void navigate(() => window.desktop.activate(editState.documentId)); });
for (const [id, saveAs] of [['save', false], ['save-as', true]]) document.getElementById(id).addEventListener('click', () => {
  void navigate(() => window.desktop.save({ documentId: editState.documentId, revision: editState.revision, saveAs }));
});
document.getElementById('reload-file').addEventListener('click', () => { void navigate(() => window.desktop.reload(editState.documentId)); });
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if(event.key.toLowerCase()==='n'&&!document.querySelector('dialog[open]')){event.preventDefault();document.getElementById('new-document').click();}
  if (event.key.toLowerCase() === 's') { event.preventDefault(); document.getElementById(event.shiftKey ? 'save-as' : 'save').click(); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); document.getElementById('reload-file').click(); }
});
async function refreshChangedFile() {
  if (opening || booting || !editState || editorDirty() || !document.getElementById('auto-refresh').checked || !diskChanges.has(editState.documentId)) return;
  const id = editState.documentId; const change = diskChanges.get(id);
  if (change.error) return;
  // Consume this event; a later event arriving during rendering remains pending.
  diskChanges.delete(id);
  await navigate(() => window.desktop.activate(id));
}
window.desktop.onFileChange(change => {
  diskChanges.set(change.documentId, change);
  const tab = tabItems.find(item => item.documentId === change.documentId); if (tab) tab.external = true;
  updateTabs(tabItems, activeId); fileStatus(); void refreshChangedFile();
  if (searchId) invalidateSearch();
});
document.getElementById('auto-refresh').addEventListener('change', () => { fileStatus(); void refreshChangedFile(); });
async function waitForImages() {
  await Promise.all([...document.querySelectorAll('#markdown-content img')].map(async image => {
    await image.decode();
    if (!image.naturalWidth) throw new Error(`图片无法加载：${image.getAttribute('src')}`);
  }));
}
async function navigate(load,route=null) {
  if (opening) return;
  if(editState&&visits[visitIndex]?.id===editState.documentId)visits[visitIndex].top=document.getElementById('reader').scrollTop;
  opening = true; controls();
  cancelPreview();
  attemptedGeneration=previewGeneration;
  let savedDuringNavigation=false;
  try {
    await previewRun;
    await flushEditor();
    await window.desktopViewer.saveReadingState();
    const selected = await load();
    if (!selected) { if(!matchedPreview())attemptedGeneration=-1;return; }
    savedDuringNavigation=Boolean(selected.saved);
    if (selected.workspaces) for (const workspace of selected.workspaces) await showWorkspace(workspace);
    if (selected.persistenceWarning) document.getElementById('session-status').textContent = selected.persistenceWarning;
    if(selected.previousDocumentId){editor.renameDocument(selected.previousDocumentId,selected.documentId);for(const item of visits)if(item.id===selected.previousDocumentId)item.id=selected.documentId;}
    updateTabs(selected.tabs, selected.documentId);
    if(route){visitIndex=route.index;}
    else if(visits[visitIndex]?.id!==selected.documentId||selected.jumpAnchor!==undefined){
      visits=visits.slice(0,visitIndex+1);visits.push({id:selected.documentId,top:0});
      if(visits.length>100)visits.shift();visitIndex=visits.length-1;
    }
    editState = selected; editor.showDocument(selected.documentId, selected.markdown, Boolean(selected.reloaded));
    window.desktopShell?.sync();
    if (selected.recovered && !shownRecoveries.has(selected.documentId)) {
      shownRecoveries.add(selected.documentId); window.desktopShell?.mode('split');
    }
    if(selected.created)window.desktopShell?.mode('split');
    if (!selected.external) diskChanges.delete(selected.documentId);
    else if (!diskChanges.has(selected.documentId)) diskChanges.set(selected.documentId, { documentId: selected.documentId, error: null });
    fileStatus();
    request = null;
    attemptedGeneration=previewGeneration;
    status.textContent = '正在渲染文档和图表…';
    document.getElementById('filename').textContent = selected.filename;
    await window.desktopViewer.snapshotDom(selected);
    await waitForImages();
    const diagnostics = window.desktopViewer.diagnostics();
    if (diagnostics.length) throw new Error(`渲染诊断：${JSON.stringify(diagnostics)}`);
    await window.desktopViewer.restoreReadingState();
    if(route)document.getElementById('reader').scrollTo({top:route.top,behavior:'instant'});
    if(selected.jumpAnchor){
      const target=[...document.querySelectorAll('#markdown-content [id]')].find(node=>node.id===selected.jumpAnchor);
      if(target)target.scrollIntoView({block:'start',behavior:'instant'});
      else status.textContent=`未找到文档锚点：${selected.jumpAnchor}`;
    }
    if(selected.jumpAnchor==='')document.getElementById('reader').scrollTo({top:0,behavior:'instant'});
    if (selected.jumpLine) { window.desktopViewer.jumpToLine(selected.jumpLine); editor.revealLine(selected.jumpLine); }
    request = selected;
    status.textContent = `${selected.saved ? '已保存 · ' : ''}预览完成 · 图表已渲染 · 可以导出 Word / PDF`;
    if(selected.jumpAnchor&&![...document.querySelectorAll('#markdown-content [id]')].some(node=>node.id===selected.jumpAnchor))status.textContent=`文档已打开，未找到锚点：${selected.jumpAnchor}`;
    document.dispatchEvent(new Event('desktop:rendered'));
  } catch (error) { status.textContent = `${savedDuringNavigation?'文件已保存，预览失败':'操作失败'}：${error.message || error}`; }
  finally {
    opening = false; controls(); fileStatus();
    if(!document.getElementById('book-panel').hidden)void loadBook();
    void refreshRecent().catch(error => { status.textContent = error.message; });
    setTimeout(() => { void refreshChangedFile(); }, 0);
    schedulePreview();
    void drainExternalOpens();
  }
}
document.getElementById('open').addEventListener('click', () => { void navigate(() => window.desktop.open()); });
document.getElementById('new-document').addEventListener('click',()=>{void navigate(()=>window.desktop.newDocument()).then(()=>{if(editState?.untitled)editor.focus();});});
function travel(step){const index=visitIndex+step,item=visits[index];if(!item||opening)return;void navigate(()=>window.desktop.activate(item.id),{index,top:item.top});}
document.getElementById('nav-back').addEventListener('click',()=>travel(-1));
document.getElementById('nav-forward').addEventListener('click',()=>travel(1));
document.addEventListener('keydown',event=>{if(event.altKey&&!event.ctrlKey&&!event.metaKey&&['ArrowLeft','ArrowRight'].includes(event.key)&&!document.querySelector('dialog[open]')){event.preventDefault();travel(event.key==='ArrowLeft'?-1:1);}});
document.getElementById('open-summary').addEventListener('click',()=>{void navigate(()=>window.desktop.openLocalLink({documentId:editState.documentId,documentVersion:editState.documentVersion,summary:true}));});
function reportOpenWarnings(issues) {
  openWarnings.push(...issues);if(openWarnings.length>32)openWarnings.splice(0,openWarnings.length-32);
  document.getElementById('open-notice-text').textContent=openWarnings.join('\n');
  document.getElementById('open-notice').hidden=!openWarnings.length;
}
document.getElementById('dismiss-open-notice').addEventListener('click',()=>{openWarnings.length=0;reportOpenWarnings([]);});
async function drainExternalOpens() {
  if(externalDraining||opening||booting||editor.composing)return;
  externalDraining=true;
  try {
    while(!opening&&!booting&&!editor.composing) {
      const pending=await window.desktop.pendingOpens();reportOpenWarnings(pending.warnings);
      if(!pending.requests.length)break;
      document.querySelectorAll('dialog[open]').forEach(node=>node.close());
      await navigate(async()=>{
        const result=await window.desktop.openPending(pending.requests[0].id);
        const issues=[...result.issues];
        for(const workspace of result.workspaces) {
          try {await showWorkspace(workspace);}catch(error){issues.push(`目录加载失败：${workspace.name}（${error.message}）`);}
        }
        reportOpenWarnings(issues);
        return result.selected;
      });
    }
  } catch(error) {reportOpenWarnings([`外部打开失败：${error.message}`]);}
  finally {externalDraining=false;}
}
window.desktop.onExternalOpen(()=>{void drainExternalOpens();});
let dragDepth=0;
function hideDrop(){dragDepth=0;document.getElementById('drop-overlay').hidden=true;}
window.addEventListener('dragenter',event=>{
  event.preventDefault();if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
  dragDepth++;document.getElementById('drop-overlay').hidden=false;
});
window.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=Array.from(event.dataTransfer.types).includes('Files')?'copy':'none';});
window.addEventListener('dragleave',()=>{if(--dragDepth<=0)hideDrop();});
window.addEventListener('drop',event=>{
  const files=Array.from(event.dataTransfer?.files||[]);
  hideDrop();
  if(!files.length&&event.target.closest?.('.cm-content'))return;
  // Handle native files before CodeMirror can insert their contents as text.
  event.preventDefault();event.stopPropagation();
  if(!files.length)reportOpenWarnings(['请拖入本机 Markdown 文件或文件夹；不支持网址或纯文本拖放。']);
  else {
    try {void window.desktop.openDroppedFiles(files).catch(error=>reportOpenWarnings([`拖放打开失败：${error.message}`]));}
    catch(error){reportOpenWarnings([`拖放打开失败：${error.message}`]);}
  }
},{capture:true});
window.addEventListener('blur',hideDrop);

function updateTabs(items, selectedId) {
  const activeVisit=visits[visitIndex];visits=visits.filter(item=>items.some(tab=>tab.documentId===item.id));visitIndex=activeVisit?visits.indexOf(activeVisit):-1;
  tabItems = items; activeId = selectedId;
  editor.retain(items.map(item => item.documentId));
  const container = document.getElementById('tabs'); container.replaceChildren();
  for (const item of items) {
    const tab = document.createElement('div'); tab.className = 'document-tab'; tab.dataset.documentId = item.documentId;
    tab.classList.toggle('selected',item.documentId === selectedId);
    const open = document.createElement('button'); open.className = 'tab-open'; open.textContent = `${item.filename}${item.dirty ? ' *' : ''}${item.external ? ' ↻' : ''}`;
    open.title = item.documentPath; open.setAttribute('role', 'tab'); open.setAttribute('aria-selected', String(item.documentId === selectedId));
    open.setAttribute('aria-keyshortcuts','Shift+F10');
    open.tabIndex = item.documentId === selectedId ? 0 : -1;
    open.addEventListener('click', () => { void navigate(() => window.desktop.activate(item.documentId)); });
    const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
    close.setAttribute('aria-label', `关闭 ${item.filename}`);
    close.addEventListener('click', () => { void closeTabs('current',item.documentId); });
    tab.append(open, close); container.append(tab);
  }
  controls();
}
async function closeTabs(mode,documentId) {
  let canceled=false;
  await navigate(async()=>{
    const result=await window.desktop.closeTabs({mode,documentId});canceled=Boolean(result.canceled);
    return afterClose(result);
  });
  const target=canceled?document.querySelector(`.document-tab[data-document-id="${documentId}"] .tab-open`):document.querySelector('.tab-open[aria-selected="true"]');
  (target||document.querySelector('#welcome [data-shell-action="new-document"]'))?.focus({preventScroll:true});
}
async function afterClose(result) {
  if (result.canceled) return null;
  updateTabs(result.tabs, result.activeId);
  if (result.activeId) return null;
  request = null;
  if (result.tabs.length) return window.desktop.activate(result.tabs[result.tabs.length - 1].documentId);
  editState = null; editor.clear(); fileStatus();
  window.desktopViewer.clear(); document.getElementById('filename').textContent = '请选择本地文件';
  status.textContent = '文档已关闭';
  return null;
}

async function loadDirectory(workspace, entryId, list) {
  const items = await window.desktop.listWorkspace({ workspaceId: workspace.id, entryId });
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    const button = document.createElement('button'); button.textContent = `${item.kind === 'directory' ? '▸ ' : ''}${item.name}`;
    button.dataset.entryId = item.id; button.dataset.name = item.name;
    if (item.kind === 'directory') {
      button.className = 'tree-dir'; button.setAttribute('aria-expanded', 'false');
      const children = document.createElement('ul'); children.className = 'file-tree'; children.hidden = true;
      button.addEventListener('click', () => { void navigate(async () => {
        if (!children.hidden) { children.hidden = true; button.setAttribute('aria-expanded', 'false'); return null; }
        try {
          await loadDirectory(workspace, item.id, children); children.hidden = false; button.setAttribute('aria-expanded', 'true');
        } catch (error) {
          children.replaceChildren(); const text = document.createElement('li'); text.className = 'tree-error'; text.textContent = error.message;
          children.append(text); children.hidden = false;
        }
        return null;
      }); });
      row.append(button, children);
    } else {
      button.className = 'tree-file'; button.dataset.supported = String(item.supported); button.disabled = !item.supported;
      if (!item.supported) button.title = item.kind === 'link' ? '链接条目暂不展开' : '当前版本暂不预览此文件类型';
      button.addEventListener('click', () => { void navigate(() => window.desktop.openWorkspaceFile({ workspaceId: workspace.id, entryId: item.id })); });
      row.append(button);
    }
    list.append(row);
  }
}
async function showWorkspace(workspace) {
  const sidebar = document.getElementById('workspaces');
  let view = workspaceViews.get(workspace.id);
  if (!view) {
    const section = document.createElement('section'); section.dataset.workspaceId = workspace.id;
    const header = document.createElement('div'); header.className = 'workspace-header';
    const title = document.createElement('strong'); title.textContent = workspace.name;
    const refresh = document.createElement('button'); refresh.className = 'workspace-refresh'; refresh.textContent = '刷新';
    const close = document.createElement('button'); close.className = 'workspace-close'; close.textContent = '关闭';
    const list = document.createElement('ul'); list.className = 'file-tree';
    refresh.addEventListener('click', () => { void navigate(async () => { await loadDirectory(workspace, workspace.id, list); return null; }); });
    close.addEventListener('click', () => { void navigate(async () => {
      const result = await window.desktop.closeWorkspace(workspace.id);
      if (result.canceled) return null;
      section.remove(); workspaceViews.delete(workspace.id); sidebar.hidden = workspaceViews.size === 0;
      invalidateSearch(); updateSearchWorkspaces();
      return afterClose(result);
    }); });
    header.append(title, refresh, close); section.append(header, list); sidebar.append(section);
    view = { section, list, workspace }; workspaceViews.set(workspace.id, view);
    updateSearchWorkspaces();
  }
  sidebar.hidden = false;
  await loadDirectory(workspace, workspace.id, view.list);
}
document.getElementById('open-workspace').addEventListener('click', () => { void navigate(async () => {
  const workspace = await window.desktop.openWorkspace();
  if (workspace) await showWorkspace(workspace);
  return null;
}); });
function updateSearchWorkspaces() {
  const select = document.getElementById('search-workspace'); const previous = select.value;
  select.replaceChildren();
  for (const { workspace } of workspaceViews.values()) {
    const option = document.createElement('option'); option.value = workspace.id; option.textContent = workspace.name; select.append(option);
  }
  if (workspaceViews.has(previous)) select.value = previous;
  controls();
}
async function refreshRecent() {
  const generation = ++recentGeneration;
  const items = await window.desktop.recent(); if (generation !== recentGeneration) return;
  const list = document.getElementById('recent-list'); list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li'); const button = document.createElement('button');
    button.className = 'recent-open'; button.textContent = item.filename; button.title = item.documentPath; button.disabled = opening;
    button.addEventListener('click', () => { void navigate(() => window.desktop.openRecent(item.id)); }); row.append(button); list.append(row);
  }
}
document.getElementById('clear-recent').addEventListener('click', () => { void navigate(async () => { await window.desktop.clearRecent(); return null; }); });
function invalidateSearch() {
  if (searchId) void window.desktop.cancelSearch(searchId);
  searchId = null; document.getElementById('search-results').replaceChildren();
  document.getElementById('search-status').textContent = ''; controls();
}
for (const id of ['search-query', 'search-mode', 'search-workspace']) document.getElementById(id).addEventListener(id === 'search-query' ? 'input' : 'change', invalidateSearch);
document.getElementById('search-cancel').addEventListener('click', () => {
  invalidateSearch(); document.getElementById('search-status').textContent = '已取消检索';
});
document.getElementById('search-form').addEventListener('submit', async event => {
  event.preventDefault(); if (opening || searchId || !workspaceViews.size) return;
  const query = document.getElementById('search-query').value;
  if (!query.trim()) return;
  const workspaceId = document.getElementById('search-workspace').value;
  const id = crypto.randomUUID(); searchId = id; controls();
  document.getElementById('search-results').replaceChildren(); document.getElementById('search-status').textContent = '正在检索…';
  try {
    const result = await window.desktop.search({ id, workspaceId, query, mode: document.getElementById('search-mode').value });
    if (searchId !== id) return;
    if (result.canceled) { document.getElementById('search-status').textContent = '已取消检索'; return; }
    document.getElementById('search-status').textContent = `${result.items.length} 条结果 · 扫描 ${result.files} 个 Markdown 文件${result.truncated ? ' · 已达扫描或结果上限，请缩小范围' : ''}${result.skipped ? ` · 跳过 ${result.skipped} 项` : ''}`;
    for (const item of result.items) {
      const row = document.createElement('li'); const button = document.createElement('button'); button.className = 'search-result';
      button.textContent = `${item.name}:${item.line}${item.snippet ? '\n' + item.snippet : ''}`;
      button.addEventListener('click', () => { void navigate(async () => ({
        ...await window.desktop.openWorkspaceFile({ workspaceId, entryId: item.entryId }), jumpLine: item.line,
      })); }); row.append(button); document.getElementById('search-results').append(row);
    }
  } catch (error) { if (searchId === id) document.getElementById('search-status').textContent = `检索失败：${error.message}`; }
  finally { if (searchId === id) { searchId = null; controls(); } }
});
async function applyLocale() {
  const locale = await globalThis.platform.settings.get('preferredLocale');
  await globalThis.platform.i18n.setLocale(locale);
  const t = key => globalThis.platform.i18n.translate(key) || key;
  for (const [id, key] of [['open', 'open_file'], ['docx', 'export_menu_export_docx'], ['cancel-export', 'cancel'], ['clear-cache', 'cache_clear'], ['cache-stats-button', 'cache_refresh']]) {
    const node = document.getElementById(id); (node.querySelector('strong') || node).textContent = t(key);
  }
  document.documentElement.lang = globalThis.platform.i18n.getUILanguage().replace('_', '-');
  document.getElementById('locale').value = locale;
}
document.getElementById('locale').addEventListener('change', async event => {
  event.target.disabled = true;
  try { await globalThis.platform.settings.set('preferredLocale', event.target.value); await applyLocale(); }
  catch (error) { status.textContent = `语言加载失败：${error.message}`; }
  finally { event.target.disabled = false; }
});
async function showCache() {
  const stats = await globalThis.platform.cache.getStats();
  document.getElementById('cache-status').textContent = stats ? `缓存：${stats.itemCount} 项，${stats.totalSizeMB} MiB` : '缓存信息不可用';
}
document.getElementById('cache-stats-button').addEventListener('click', () => { void showCache().catch(error => { status.textContent = error.message; }); });
document.getElementById('clear-cache').addEventListener('click', async () => {
  if (!await globalThis.platform.cache.clear()) { status.textContent = '清理缓存失败'; return; }
  await showCache();
});
void window.desktopViewer.init().then(async () => {
  const select = document.getElementById('locale');
  for (const item of window.desktopViewer.locales()) {
    const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; select.append(option);
  }
  await applyLocale();
  const session = await window.desktop.session();
  for (const workspace of session.workspaces) {
    try { await showWorkspace(workspace); } catch (error) { session.warnings.push(`目录加载失败：${error.message}`); }
  }
  updateTabs(session.tabs, session.selected?.documentId || null);
  opening = false;
  if (session.selected) await navigate(async () => session.selected);
  document.getElementById('session-status').textContent = session.warnings.join('\n');
  await refreshRecent();
}).catch(error => { status.textContent = `初始化失败：${error.message}`; }).finally(() => {
  booting = false; opening = false; controls(); void refreshChangedFile();
  void drainExternalOpens();
});
async function exportDocument(format) {
    if (!request || exporting || opening) return;
    exporting = true; controls();
    const selected = request;
    lastTask = { filename:selected.filename, format, state:'running', message:`正在准备 ${format.toUpperCase()}…` };
    status.textContent = `正在准备 ${format.toUpperCase()}…`;
    try {
      exportPromise = window.desktop.exportDocument({ format, documentId: selected.documentId, documentVersion: selected.documentVersion });
      const result = await exportPromise;
      status.textContent = result?.canceled ? '已取消导出'
        : `已保存：${result.path}（${result.bytes} 字节，来源：${selected.filename}）`;
      lastTask.state = result?.canceled ? 'canceled' : 'complete';
    } catch (error) { lastTask.state = 'failed'; status.textContent = `操作失败：${error.message || error}`; }
    finally { lastTask.message = status.textContent; exportPromise = null; exporting = false; controls(); }
}
window.desktopApp = {
  closeTabs,
  state:() => ({ document:editState, tabs:tabItems, busy:opening || booting, dirty:editorDirty(), exporting, task:lastTask,
    preview:{running:previewRunning,live:livePreview,synchronized:scrollSync,current:matchedPreview()} }),
  configurePreview:preferences => {
    if(typeof preferences.livePreview==='boolean' && preferences.livePreview!==livePreview) {
      livePreview=preferences.livePreview;
      if(!livePreview) {cancelPreview();if(previewRunning||!matchedPreview())status.textContent='实时预览已关闭，可手动更新。';}
      else {attemptedGeneration=-1;schedulePreview();}
    }
    if(typeof preferences.scrollSync==='boolean')scrollSync=preferences.scrollSync;
  },
  activate:id => navigate(() => window.desktop.activate(id)),
  openRecent:id => navigate(() => window.desktop.openRecent(id)),
  export:exportDocument,
};
controls();

function bookPath(href){
  try {
    if(!book||!href||/^[a-z][a-z\d+.-]*:|^[\\/]/i.test(href))return null;
    const relative=decodeURIComponent(new URL(href,'https://book.invalid/').pathname).replace(/^\//,'');
    return (book.root.replace(/\\/g,'/')+'/'+(relative||'SUMMARY.md')).toLowerCase();
  }catch{return null;}
}
function syncBook(){
  const path=editState?.documentPath?.replace(/\\/g,'/').toLowerCase();
  if(bookPath(bookEntries[bookChosen]?.href)!==path)bookChosen=bookEntries.findIndex(item=>bookPath(item.href)===path);
  document.querySelectorAll('.book-entry').forEach((button,index)=>{
    if(index===bookChosen)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    button.disabled=opening||booting;
  });
  document.getElementById('book-previous').disabled=opening||booting||bookChosen<=0;
  document.getElementById('book-next').disabled=opening||booting||bookChosen<0||bookChosen>=bookEntries.length-1;
}
async function loadBook(force=false){
  if(opening||booting)return;
  if(!force&&bookLoadedId===editState?.documentId)return;
  const epoch=++bookEpoch,id=editState?.documentId;bookLoadedId=id;
  document.getElementById('book-status').textContent='正在读取章节目录…';
  try{
    if(!editState||editState.untitled)throw Error('请先打开已保存的本机文档。');
    await flushEditor();
    if(opening||epoch!==bookEpoch||id!==editState?.documentId)return;
    const result=await window.desktop.summaryIndex({documentId:id});
    if(epoch!==bookEpoch||id!==editState?.documentId)return;
    const parsed=window.desktopViewer.summaryTree(result.markdown);
    book=result;bookEntries=[];bookChosen=-1;
    const render=entries=>{
      const list=document.createElement('ul');
      for(const entry of entries){
        const row=document.createElement('li'),label=document.createElement(entry.href?'button':'span');label.textContent=entry.label||'未命名章节';
        if(entry.href){
          const index=bookEntries.length;bookEntries.push(entry);label.className='book-entry';
          label.addEventListener('click',()=>{void openChapter(index);});
        }else label.className='book-group';
        row.append(label);if(entry.children.length)row.append(render(entry.children));list.append(row);
      }
      return list;
    };
    document.getElementById('book-tree').replaceChildren(render(parsed.entries));
    document.getElementById('book-status').textContent=`${bookEntries.length} 个章节${parsed.truncated?' · 目录已达显示上限':''}${bookEntries.length?'':' · SUMMARY 中没有列表章节'}`;
    syncBook();
  }catch(error){
    if(epoch!==bookEpoch||id!==editState?.documentId)return;
    book=null;bookEntries=[];bookChosen=-1;document.getElementById('book-tree').replaceChildren();
    document.getElementById('book-status').textContent=`章节目录不可用：${error.message}`;syncBook();
  }
}
async function openChapter(index){
  const entry=bookEntries[index];if(!entry||!book)return;
  await navigate(async()=>{
    const selected=await window.desktop.openLocalLink({documentId:editState.documentId,documentVersion:editState.documentVersion,href:entry.href,fromSummary:true,summaryScope:book.scope});
    bookChosen=index;return selected;
  });
}
document.querySelectorAll('[data-shell-nav="book"]').forEach(button=>button.addEventListener('click',()=>{void loadBook();}));
document.getElementById('book-refresh').addEventListener('click',()=>{void loadBook(true);});
document.getElementById('book-previous').addEventListener('click',()=>{void openChapter(bookChosen-1);});
document.getElementById('book-next').addEventListener('click',()=>{void openChapter(bookChosen+1);});

// Synchronize only matching revisions. Programmatic scrolls never feed back into
// the originating pane; a new wheel/pointer/key action can take over immediately.
let scrollFrame=0, scrollOwner=null, scrollUntil=0;
const split=()=>document.getElementById('desktop-app').dataset.mode==='split';
function syncScroll(side) {
  if(!scrollSync||!split()||opening||editor.composing||!matchedPreview())return;
  if(scrollOwner && scrollOwner!==side && performance.now()<scrollUntil)return;
  cancelAnimationFrame(scrollFrame);
  scrollFrame=requestAnimationFrame(()=>{
    if(!scrollSync||!split()||opening||!matchedPreview())return;
    scrollOwner=side;scrollUntil=performance.now()+180;
    if(side==='source')window.desktopViewer.revealLine(editor.viewportLine());
    else {const line=window.desktopViewer.sourceLine();if(line!==null)editor.revealLine(line);}
  });
}
document.addEventListener('desktop:editor-scroll',()=>syncScroll('source'));
document.getElementById('reader').addEventListener('scroll',()=>syncScroll('preview'),{passive:true});
for(const [id,side] of [['editor-host','source'],['reader','preview']]) {
  for(const event of ['wheel','pointerdown','touchstart','keydown']) document.getElementById(id).addEventListener(event,()=>{
    if(side==='preview')readerInteraction++;
    scrollOwner=side;scrollUntil=0;
  },{passive:true});
}
function locatePreview(line) {
  if(!matchedPreview()) {status.textContent='预览尚未更新，暂不能定位；请等待或点击“更新预览”。';return;}
  scrollOwner='source';scrollUntil=performance.now()+180;
  window.desktopViewer.jumpToLine(Math.floor(line));
}
document.getElementById('locate-preview').addEventListener('click',()=>locatePreview(editor.selectionLine));
document.addEventListener('desktop:source-jump',event=>{if(event.detail.documentId===editState?.documentId)locatePreview(event.detail.line);});
function locateSource(line) {
  if(!matchedPreview()||!Number.isFinite(line))return;
  window.desktopShell.mode('split');scrollOwner='preview';scrollUntil=performance.now()+180;
  editor.revealLine(line,true);
}
document.getElementById('locate-source').addEventListener('click',()=>locateSource(window.desktopViewer.sourceLine()));
document.getElementById('markdown-content').addEventListener('dblclick',event=>{
  if(event.target.closest('a,button,input,textarea,select,svg,canvas'))return;
  const block=event.target.closest('.md-block[data-line]');if(!block||!matchedPreview())return;
  const rect=block.getBoundingClientRect(),count=Number(block.dataset.lineCount||1);
  const fraction=Math.max(0,Math.min(.999,(event.clientY-rect.top)/Math.max(1,rect.height)));
  locateSource(Number(block.dataset.line)+1+Math.floor(fraction*count));
});
document.getElementById('cancel-export').addEventListener('click', async () => {
  document.getElementById('cancel-export').disabled = true;
  try {
    await window.desktop.cancelExport();
    await exportPromise;
  } catch { /* The export handler owns its terminal status. */ }
  finally { controls(); }
});
document.getElementById('markdown-page').addEventListener('click', event => {
  const anchor = event.target.closest?.('a');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href') || '';
  if(!matchedPreview()){status.textContent='请先更新预览再打开文档链接。';return;}
  void navigate(()=>window.desktop.openLocalLink({documentId:editState.documentId,documentVersion:editState.documentVersion,href}));
});
