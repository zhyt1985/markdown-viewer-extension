let request = null;
const { ui, bindUi, bindUiAttribute, uiFilename } = window.desktopViewer;
let tabItems = [];
let activeId = null;
const workspaceViews = new Map();
let workspaceMarker = null;
let opening = true;
let booting = true;
let openingPreview = null;
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
let settingsDefinition = null;
let settingsLoading = false;
const openWarnings = [];
let visits=[],visitIndex=-1;
let book=null,bookEntries=[],bookLoadedId=null,bookEpoch=0,bookChosen=-1;
const diskChanges = new Map();
const shownRecoveries = new Set();
const editor = window.desktopCodeEditor;
const normalized = text => text.replace(/\r\n?/g, '\n');
let pendingRevision=-1, pendingMarkdown=null, pendingResult=false;
function editorPending() {
  if(!editState || editState.readOnly)return false;
  if(pendingRevision!==editor.revision||pendingMarkdown!==editState.markdown) {
    pendingResult=editor.value!==normalized(editState.markdown);
    pendingRevision=editor.revision;pendingMarkdown=editState.markdown;
  }
  return pendingResult;
}
const editorDirty = () => Boolean(editState?.dirty || editorPending());
const status = document.getElementById('status');
const exportButtons = ['docx', 'pdf', 'html', 'png'].map(id => document.getElementById(id));
let assetRows = [];
let assetView = null;
let assetMessage = '';
const assetsCurrent = () => !opening && !booting && !previewRunning && !editorPending() && window.desktopViewer.assetsReady(editState);
const folderList = document.getElementById('resource-folder-list');
let listedFolders;
function resourceFolderControls(busy) {
  const available = Boolean(editState && !editState.untitled && (!editState.readOnly || editState.html || editState.slidev || editState.diagramType));
  const open = document.getElementById('resource-folders-open');
  open.disabled = busy || !available;
  const folders = editState?.resourceFolders;
  document.getElementById('resource-folder-add').disabled = busy || !available || (folders?.length || 0) >= 8;
  document.getElementById('resource-folder-empty').hidden = Boolean(folders?.length);
  if (listedFolders !== folders) {
    listedFolders = folders;
    folderList.replaceChildren(...(folders || []).map(({ id, folder }) => {
      const item = document.createElement('li');
      const name = document.createElement('span'); name.textContent = folder;
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.revokeResource = id;
      bindUi(remove, '撤销授权'); bindUiAttribute(remove, 'aria-label', '撤销目录授权：{0}', folder);
      item.append(name, remove);
      return item;
    }));
  }
  for (const remove of folderList.querySelectorAll('button')) remove.disabled = busy || !available;
}
function controls() {
  const busy = opening || booting;
  document.getElementById('workspace-reveal').disabled = busy || !editState?.documentPath || !workspaceViews.size;
  if (workspaceMarker && (workspaceMarker.documentId !== activeId || !workspaceMarker.button.isConnected)) {
    workspaceMarker.button.removeAttribute('aria-current');
    workspaceMarker = null;
  }
  document.getElementById('asset-open').disabled = exporting || !assetsCurrent();
  assetControls();
  resourceFolderControls(busy);
  const editable = Boolean(editState && !editState.readOnly);
  for (const id of ['settings-apply', 'settings-reset']) {
    document.getElementById(id).disabled = busy || settingsLoading || !settingsDefinition;
  }
  for (const field of document.querySelectorAll('[data-setting-key]')) field.disabled = busy || settingsLoading;
  document.getElementById('open').disabled = busy;
  document.getElementById('open-with-encoding').disabled = busy;
  document.getElementById('nav-back').disabled=busy||visitIndex<=0;
  document.getElementById('nav-forward').disabled=busy||visitIndex>=visits.length-1;
  document.getElementById('open-summary').disabled=busy||!editable||editState.untitled;
  document.getElementById('new-document').disabled = busy || tabItems.length>=32;
  document.getElementById('paste-html').disabled = busy || tabItems.length >= 32;
  const convertHtml = document.getElementById('convert-html');
  convertHtml.hidden = !editState?.html;
  convertHtml.disabled = busy || !editState?.html || tabItems.length >= 32;
  const diagramSource = document.getElementById('diagram-source');
  diagramSource.hidden = !editState?.diagramType;
  diagramSource.disabled = busy || !editState?.diagramType;
  diagramSource.setAttribute('aria-pressed', String(Boolean(editState?.diagramType && !document.getElementById('mv-source-view').hidden)));
  document.getElementById('open-workspace').disabled = busy;
  for (const button of document.querySelectorAll('.tab-open')) button.disabled = busy && !openingPreview;
  for (const button of document.querySelectorAll('.tab-close, .tree-dir, .tree-file[data-supported="true"], .tree-page-button, .workspace-refresh, .workspace-close, .recent-open, .recent-workspace-open, .search-result')) button.disabled = busy;
  const slideExport = editState?.slidev && window.desktopViewer.slideStatus()?.issues === 0;
  for (const button of exportButtons) button.disabled = busy || (!editable && !editState?.diagramType && !(slideExport && button.id === 'pdf')) || exporting || !request || editorPending() || editState?.documentVersion !== request?.documentVersion;
  document.getElementById('cancel-export').disabled = !exporting;
  document.getElementById('clear-recent').disabled = busy;
  document.getElementById('search-start').disabled = busy || workspaceViews.size === 0 || Boolean(searchId);
  document.getElementById('search-cancel').disabled = !searchId;
  for (const id of ['edit-toggle', 'preview-draft', 'save-as']) document.getElementById(id).disabled = busy || !editable;
  document.getElementById('save-as-utf8').disabled = busy || !editable || editState.encoding === 'utf-8';
  document.getElementById('reload-file').disabled = busy || !editState || editState.untitled;
  document.getElementById('save').disabled = busy || !editable || (!editState.untitled&&!editorDirty());
  editor.disabled = busy || !editable;
  document.getElementById('locate-preview').disabled = busy || !editable || !matchedPreview();
  document.getElementById('locate-source').disabled = busy || !editable || !matchedPreview();
  bindUi(document.getElementById('preview-draft'), previewRunning ? "正在更新…" : "更新预览");
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
  if (!livePreview || opening || booting || !editState || editState.readOnly || editor.composing || attemptedGeneration === previewGeneration) return;
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
    const interaction=readerInteraction;
    const anchor=scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && document.getElementById('editor-pane').contains(document.activeElement)
      ? editor.viewportLine() : window.desktopViewer.sourceLine();
    const top=window.desktopViewer.readingPosition();
    bindUi(status, "正在更新预览，仍可继续编辑…");
    await window.desktopViewer.snapshotDom(selected);
    if(!current())return;
    await waitForImages();
    if(!current())return;
    const diagnostics=window.desktopViewer.diagnostics();
    if(diagnostics.length)throw Error(ui("渲染诊断：{0}", JSON.stringify(diagnostics)));
    const latestAnchor=readerInteraction!==interaction ? window.desktopViewer.sourceLine()
      : scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && document.getElementById('editor-pane').contains(document.activeElement)
        ? editor.viewportLine() : anchor;
    window.desktopViewer.finishPreview(latestAnchor,top);
    if(readerInteraction!==interaction && scrollSync && document.getElementById('desktop-app').dataset.mode==='split' && latestAnchor!==null) {
      scrollOwner='preview';scrollUntil=performance.now()+180;editor.revealLine(latestAnchor);
    }
    request=selected;
    bindUi(status, "预览已更新 · 可以导出");
    document.dispatchEvent(new Event('desktop:rendered'));
  })().catch(error=>{
    if (!opening && generation===previewGeneration) { attemptedGeneration=generation; bindUi(status, "预览失败：{0}；可修改后重试或手动更新。", error.message || error); }
  }).finally(()=>{
    previewRunning=false;controls();fileStatus();schedulePreview();
  });
  return previewRun;
}
function fileStatus() {
  const fileNotice = document.getElementById('file-status');
  const changed = Boolean(editState && diskChanges.has(editState.documentId));
  fileNotice.classList.toggle('external-change', changed);
  fileNotice.textContent = changed
    ? ui("磁盘文件有变化{0}。{1}", diskChanges.get(editState.documentId)?.error ? ui("或暂不可用") : '', editorDirty() ? ui("编辑稿已保留；请另存为，或重新载入磁盘并放弃编辑。") : ui("可重新载入；自动刷新关闭时保留当前内容。"))
    : editState?.untitled ? ui("未命名文档尚未保存到文件。相对图片和本机资源将在首次保存后解析。") : editorDirty() ? ui("有未保存的修改。") : '';
  if (editState?.draftError) document.getElementById('file-status').textContent += ui(" 草稿暂存失败：{0}。请立即保存或另存为。", editState.draftError);
  else if (editState?.recovered) document.getElementById('file-status').textContent += ui(" 已恢复本地草稿，尚未保存到源文件。");
  if (editState?.encodingWarning) document.getElementById('file-status').textContent += ` ${editState.encodingWarning}`;
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
  bindUi(status, livePreview ? "源码已修改，等待更新预览…" : "源码已修改，点击“更新预览”后可导出。");
  controls(); fileStatus();
  const selected = document.querySelector('.tab-open[aria-selected="true"]');
  const currentTab = tabItems.find(item => item.documentId === editState?.documentId);
  if (selected && currentTab) selected.textContent = `${uiFilename(currentTab)} *`;
  clearTimeout(editTimer); editTimer = setTimeout(() => { void flushEditor().catch(error => { bindUi(status, "编辑稿同步失败：{0}", error.message); }); }, 150);
  schedulePreview();
});
document.addEventListener('desktop:editor-composition',()=>{if(editor.composing)cancelPreview();else {schedulePreview();void drainExternalOpens();}});
document.getElementById('preview-draft').addEventListener('click', () => { void navigate(() => window.desktop.activate(editState.documentId)); });
for (const [id, saveAs, encoding] of [['save', false], ['save-as', true], ['save-as-utf8', true, 'utf-8']]) document.getElementById(id).addEventListener('click', () => {
  void navigate(() => window.desktop.save({ documentId: editState.documentId, revision: editState.revision, saveAs, encoding }));
});
document.getElementById('reload-file').addEventListener('click', () => { void navigate(() => window.desktop.reload(editState.documentId)); });
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('dialog[open]')) return;
  if(event.key.toLowerCase()==='n'){event.preventDefault();document.getElementById('new-document').click();}
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
    if (!image.naturalWidth) throw new Error(ui("图片无法加载：{0}", image.getAttribute('src')));
  }));
}
function activateTab(id) {
  if (openingPreview && id !== activeId && tabItems.some(item => item.documentId === id)) {
    const progress = openingPreview;
    const firstRequest = !progress.next;
    progress.next = id;
    if (firstRequest) {
      cancelPreview();
      progress.interrupt();
    }
    return progress.switched;
  }
  return navigate(() => window.desktop.activate(id));
}
async function navigate(load,route=null) {
  if (opening) return;
  if(editState&&visits[visitIndex]?.id===editState.documentId)visits[visitIndex].top=window.desktopViewer.readingPosition();
  opening = true; controls();
  cancelPreview();
  attemptedGeneration=previewGeneration;
  let savedDuringNavigation=false;
  let progress, stopTrackingScroll, userScrolled = false;
  const reader = document.getElementById('reader');
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
    editState = selected;
    if (selected.readOnly) editor.clear(true);
    else editor.showDocument(selected.documentId, selected.markdown, Boolean(selected.reloaded));
    await window.desktopViewer.prepareReadingState(selected.documentId);
    if (selected.recovered && !shownRecoveries.has(selected.documentId)) {
      shownRecoveries.add(selected.documentId);
      if (!window.desktopViewer.documentMode()) window.desktopViewer.rememberDocumentMode('split');
    }
    if (selected.created) window.desktopViewer.rememberDocumentMode('split');
    window.desktopShell?.sync();
    if (!selected.external) diskChanges.delete(selected.documentId);
    else if (!diskChanges.has(selected.documentId)) diskChanges.set(selected.documentId, { documentId: selected.documentId, error: null });
    fileStatus();
    request = null;
    attemptedGeneration=previewGeneration;
    bindUi(status, "正在渲染文档和图表…");
    document.getElementById('filename').textContent = uiFilename(selected);
    const interaction = readerInteraction;
    const trackScroll = () => { if (readerInteraction !== interaction) userScrolled = true; };
    reader.addEventListener('scroll', trackScroll);
    stopTrackingScroll = () => reader.removeEventListener('scroll', trackScroll);
    if (!booting && !selected.readOnly && !savedDuringNavigation && tabItems.length > 1) {
      progress = { next: null };
      progress.interrupted = new Promise(resolve => { progress.interrupt = resolve; });
      progress.switched = new Promise(resolve => { progress.finish = resolve; });
      openingPreview = progress;
      controls();
    }
    await window.desktopViewer.snapshotDom(selected);
    if (progress?.next) return;
    await (progress ? Promise.race([waitForImages(), progress.interrupted]) : waitForImages());
    if (progress?.next) return;
    stopTrackingScroll();
    const diagnostics = window.desktopViewer.diagnostics();
    if (diagnostics.length && !selected.slidev) throw new Error(ui("渲染诊断：{0}", JSON.stringify(diagnostics)));
    window.desktopViewer.restoreReadingState(userScrolled ? reader.scrollTop : undefined);
    if(route && !userScrolled)window.desktopViewer.scrollReader(route.top);
    if(selected.jumpAnchor && !userScrolled){
      const target=[...document.querySelectorAll('#markdown-content [id]')].find(node=>node.id===selected.jumpAnchor);
      if(target)target.scrollIntoView({block:'start',behavior:'instant'});
      else bindUi(status, "未找到文档锚点：{0}", selected.jumpAnchor);
    }
    if(selected.jumpAnchor==='' && !userScrolled)window.desktopViewer.scrollReader(0);
    if (selected.jumpLine && !userScrolled) { window.desktopViewer.jumpToLine(selected.jumpLine); editor.revealLine(selected.jumpLine); }
    request = selected;
    if (selected.htmlImportOmitted) bindUi(status, '已转为 Markdown 草稿 · {0} 张图片未导入', selected.htmlImportOmitted);
    else if (selected.htmlImportOmitted === 0) bindUi(status, '已转为 Markdown 草稿');
    else if (selected.html) bindUi(status, "本地 HTML 预览 · 外部资源已禁用");
    else if (selected.slidev) {
      const deck = window.desktopViewer.slideStatus();
      if (deck.issues) bindUi(status, '演示文稿有 {0} 处资源不可用，无法导出', deck.issues);
      else if (deck.fallback) bindUi(status, '演示主题不在离线包中，已使用默认主题');
      else bindUi(status, '演示文稿已就绪 · 可以导出静态 PDF');
    }
    else if (selected.diagramType) bindUi(status, "图表预览完成 · 可以导出");
    else if (selected.readOnly) bindUi(status, "此文件以只读方式打开");
    else bindUi(status, "{0}预览完成 · 图表已渲染 · 可以导出", selected.saved ? ui("已保存 · ") : '');
    if(selected.jumpAnchor&&!userScrolled&&![...document.querySelectorAll('#markdown-content [id]')].some(node=>node.id===selected.jumpAnchor))bindUi(status, "文档已打开，未找到锚点：{0}", selected.jumpAnchor);
    document.dispatchEvent(new Event('desktop:rendered'));
  } catch (error) {
    if (!progress?.next) bindUi(status, savedDuringNavigation ? '文件已保存，预览失败：{0}' : '操作失败：{0}', error.message || error);
  }
  finally {
    stopTrackingScroll?.();
    openingPreview = null;
    opening = false;
    if (progress?.next) {
      if (userScrolled) window.desktopViewer.restoreReadingState(reader.scrollTop);
      try { await activateTab(progress.next); }
      finally { progress.finish(); }
    } else {
      progress?.finish();
      controls(); fileStatus();
      if(!document.getElementById('book-panel').hidden)void loadBook();
      void refreshRecent().catch(error => { status.textContent = error.message; });
      setTimeout(() => { void refreshChangedFile(); }, 0);
      schedulePreview();
      void drainExternalOpens();
    }
  }
}
window.desktop.onHtmlPreviewFailure(document => {
  if (editState?.documentId !== document.documentId || editState.documentVersion !== document.documentVersion) return;
  request = null;
  bindUi(status, "本地 HTML 预览失败，请重新载入。");
  controls();
});
function openFromPicker(load) {
  return navigate(async () => {
    try { return await load(); }
    catch (error) {
      reportOpenWarnings([error.message.replace(/^Error invoking remote method 'desktop:open': Error: /, '')]);
      throw error;
    }
  });
}
document.getElementById('open').addEventListener('click', () => { void openFromPicker(() => window.desktop.open()); });
document.getElementById('encoding-form').addEventListener('submit', event => {
  event.preventDefault();
  const encoding = document.getElementById('open-encoding').value;
  document.getElementById('encoding-dialog').close();
  void openFromPicker(() => window.desktop.openWithEncoding(encoding));
});
document.getElementById('new-document').addEventListener('click',()=>{void navigate(()=>window.desktop.newDocument()).then(()=>{if(editState?.untitled)editor.focus();});});
function importHtml(fromFile) {
  const origin = fromFile ? { documentId: editState.documentId, documentVersion: editState.documentVersion } : {};
  return navigate(async () => {
    const html = await window.desktop.htmlImport('source', origin);
    const readImage = fromFile ? source => window.desktop.htmlImport('image', { ...origin, source }) : undefined;
    const { markdown, omitted } = await window.desktopViewer.convertLocalHtml(html, readImage);
    const draft = await window.desktop.htmlImport('draft', { ...origin, markdown });
    return { ...draft, htmlImportOmitted: omitted };
  });
}
document.getElementById('convert-html').addEventListener('click', () => { void importHtml(true); });
document.getElementById('paste-html').addEventListener('click', () => { void importHtml(false); });
function changeResourceFolders(action, id) {
  const message = document.getElementById('resource-folder-status');
  message.textContent = '';
  return navigate(async () => {
    try {
      return await window.desktop.resourceFolders({ action, id, documentId: editState.documentId, documentVersion: editState.documentVersion });
    } catch (error) {
      bindUi(message, '操作失败：{0}', error.message);
      throw error;
    }
  });
}
document.getElementById('resource-folders-open').addEventListener('click', () => { document.getElementById('resource-folder-status').textContent = ''; });
document.getElementById('resource-folder-add').addEventListener('click', () => { void changeResourceFolders('add'); });
folderList.addEventListener('click', event => {
  const button = event.target.closest('[data-revoke-resource]');
  if (button && !button.disabled) void changeResourceFolders('remove', button.dataset.revokeResource);
});
document.getElementById('diagram-source').addEventListener('click', event => {
  event.currentTarget.setAttribute('aria-pressed', String(window.desktopViewer.toggleDiagramSource()));
});
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
          try {await showWorkspace(workspace);}catch(error){issues.push(ui("目录加载失败：{0}（{1}）", workspace.name, error.message));}
        }
        reportOpenWarnings(issues);
        return result.selected;
      });
    }
  } catch(error) {reportOpenWarnings([ui("外部打开失败：{0}", error.message)]);}
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
  if(!files.length)reportOpenWarnings([ui("请拖入受支持的本机文件或文件夹。")]);
  else {
    try {void window.desktop.openDroppedFiles(files).catch(error=>reportOpenWarnings([ui("拖放打开失败：{0}", error.message)]));}
    catch(error){reportOpenWarnings([ui("拖放打开失败：{0}", error.message)]);}
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
    const open = document.createElement('button'); open.className = 'tab-open'; open.textContent = `${uiFilename(item)}${item.dirty ? ' *' : ''}${item.external ? ' ↻' : ''}`;
    open.title = item.documentPath; open.setAttribute('role', 'tab'); open.setAttribute('aria-selected', String(item.documentId === selectedId));
    open.setAttribute('aria-keyshortcuts','Shift+F10');
    open.tabIndex = item.documentId === selectedId ? 0 : -1;
    open.addEventListener('click', () => { void activateTab(item.documentId); });
    const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
    bindUiAttribute(close, 'aria-label', "关闭 {0}", uiFilename(item));
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
  window.desktopViewer.clear(); bindUi(document.getElementById('filename'), "请选择本地文件");
  bindUi(status, "文档已关闭");
  return null;
}

async function loadDirectory(workspace, entryId, list, offset = 0) {
  const listing = await window.desktop.listWorkspace({ workspaceId: workspace.id, entryId, offset });
  renderDirectory(workspace, entryId, list, offset, listing);
}
function renderDirectory(workspace, entryId, list, offset, { items, previousOffset, nextOffset, total }) {
  const additions = document.createDocumentFragment();
  if (previousOffset !== null || nextOffset !== null) {
    const pager = document.createElement('li'); pager.className = 'tree-pagination';
    const range = document.createElement('span');
    bindUi(range, "第 {0} 至 {1} 项，共 {2} 项", items.length ? offset + 1 : 0, items.length ? offset + items.length : 0, total);
    pager.append(range);
    const buttons = document.createElement('div');
    for (const [direction, destination, label] of [['previous', previousOffset, "上一批文件"], ['next', nextOffset, "下一批文件"]]) {
      if (destination === null) continue;
      const button = document.createElement('button'); button.type = 'button';
      button.className = `tree-page-button tree-page-${direction}`; bindUi(button, label);
      button.addEventListener('click', async () => {
        const focused = document.activeElement === button;
        await navigate(async () => { await loadDirectory(workspace, entryId, list, destination); return null; });
        if (focused) {
          const current = list.firstElementChild;
          (current?.querySelector(`.tree-page-${direction}`) || current?.querySelector('button'))?.focus({ preventScroll: true });
        }
      });
      buttons.append(button);
    }
    pager.append(buttons); additions.append(pager);
  }
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
      if (!item.supported) button.title = item.kind === 'link' ? ui("链接条目暂不展开") : ui("当前版本暂不预览此文件类型");
      button.addEventListener('click', () => { void navigate(() => window.desktop.openWorkspaceFile({ workspaceId: workspace.id, entryId: item.id })); });
      row.append(button);
    }
    additions.append(row);
  }
  list.replaceChildren(additions);
}
async function revealWorkspaceFile() {
  let target;
  await navigate(async () => {
    const documentId = editState?.documentId;
    if (!editState?.documentPath || !workspaceViews.size) return null;
    const result = await window.desktop.revealWorkspaceFile(documentId);
    if (!result) { bindUi(status, '当前文件不在已打开的工作区中'); return null; }
    const view = workspaceViews.get(result.workspaceId);
    if (!view || editState?.documentId !== documentId) return null;
    let list = view.list;
    for (const step of result.steps) {
      const selector = `:scope > li > button[data-entry-id="${step.targetId}"]`;
      let item = list.querySelector(selector);
      if (!item) {
        renderDirectory(view.workspace, step.entryId, list, step.offset, step);
        item = list.querySelector(selector);
      }
      if (item.classList.contains('tree-dir')) {
        item.setAttribute('aria-expanded', 'true');
        list = item.nextElementSibling;
        list.hidden = false;
      } else target = item;
    }
    if (target) {
      workspaceMarker?.button.removeAttribute('aria-current');
      target.setAttribute('aria-current', 'true');
      workspaceMarker = { documentId, button: target };
      bindUi(status, '已在工作区定位：{0}', target.dataset.name);
    }
    return null;
  });
  return target;
}
async function showWorkspace(workspace) {
  const sidebar = document.getElementById('workspaces');
  let view = workspaceViews.get(workspace.id);
  if (!view) {
    const section = document.createElement('section'); section.dataset.workspaceId = workspace.id;
    const header = document.createElement('div'); header.className = 'workspace-header';
    const title = document.createElement('strong'); title.textContent = workspace.name; title.tabIndex = -1;
    const refresh = document.createElement('button'); refresh.className = 'workspace-refresh'; bindUi(refresh, "刷新");
    const close = document.createElement('button'); close.className = 'workspace-close'; bindUi(close, "关闭");
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
  return view;
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
  const [files, folders] = await Promise.all([window.desktop.recent(), window.desktop.recentWorkspaces()]);
  if (generation !== recentGeneration) return;
  const row = (name, location, className, open) => {
    const entry = document.createElement('li'); const button = document.createElement('button');
    button.className = className; button.textContent = name; button.title = location; button.disabled = opening;
    button.addEventListener('click', open); entry.append(button); return entry;
  };
  document.getElementById('recent-list').replaceChildren(...files.map(item => row(item.filename, item.documentPath, 'recent-open',
    () => { void navigate(() => window.desktop.openRecent(item.id)); })));
  document.getElementById('recent-workspaces-list').replaceChildren(...folders.map(item => row(item.name, item.root, 'recent-workspace-open',
    () => { void reopenWorkspace(item.id); })));
  document.getElementById('recent-files-empty').hidden = Boolean(files.length);
  document.getElementById('recent-workspaces-empty').hidden = Boolean(folders.length);
}
async function reopenWorkspace(id) {
  let workspaceId;
  await navigate(async () => {
    const workspace = await window.desktop.openRecentWorkspace(id);
    workspaceId = workspace.id;
    if (workspace.persistenceWarning) document.getElementById('session-status').textContent = workspace.persistenceWarning;
    await showWorkspace(workspace);
    return null;
  });
  const view = workspaceViews.get(workspaceId);
  if (!view?.section.isConnected) return;
  window.desktopViewer.reflowReader(() => window.desktopShell.nav('files'));
  const title = view.section.querySelector('.workspace-header strong');
  title.scrollIntoView({ block:'nearest' }); title.focus({ preventScroll:true });
}
document.getElementById('clear-recent').addEventListener('click', () => { void navigate(async () => { await window.desktop.clearRecent(); return null; }); });
function invalidateSearch() {
  if (searchId) void window.desktop.cancelSearch(searchId);
  searchId = null; document.getElementById('search-results').replaceChildren();
  document.getElementById('search-status').textContent = ''; controls();
}
window.desktop.onSearchProgress(progress => {
  if (searchId !== progress.id) return;
  bindUi(document.getElementById('search-status'), "正在检索 · 已扫描 {0} 个 Markdown 文件 · 找到 {1} 条结果",
    progress.files, progress.matches);
});
for (const id of ['search-query', 'search-mode', 'search-workspace']) document.getElementById(id).addEventListener(id === 'search-query' ? 'input' : 'change', invalidateSearch);
document.getElementById('search-cancel').addEventListener('click', () => {
  invalidateSearch(); bindUi(document.getElementById('search-status'), "已取消检索");
});
document.getElementById('search-form').addEventListener('submit', async event => {
  event.preventDefault(); if (opening || searchId || !workspaceViews.size) return;
  const query = document.getElementById('search-query').value;
  if (!query.trim()) return;
  const workspaceId = document.getElementById('search-workspace').value;
  const id = crypto.randomUUID(); searchId = id; controls();
  document.getElementById('search-results').replaceChildren(); bindUi(document.getElementById('search-status'), "正在检索…");
  try {
    const result = await window.desktop.search({ id, workspaceId, query, mode: document.getElementById('search-mode').value });
    if (searchId !== id) return;
    if (result.canceled) { bindUi(document.getElementById('search-status'), "已取消检索"); return; }
    bindUi(document.getElementById('search-status'), "{0} 条结果 · 扫描 {1} 个 Markdown 文件{2}{3}", result.items.length, result.files, result.truncated ? ui(" · 已达扫描或结果上限，请缩小范围") : '', result.skipped ? ui(" · 跳过 {0} 项", result.skipped) : '');
    for (const item of result.items) {
      const row = document.createElement('li'); const button = document.createElement('button'); button.className = 'search-result';
      button.textContent = `${item.name}:${item.line}${item.snippet ? '\n' + item.snippet : ''}`;
      button.addEventListener('click', () => { void navigate(async () => ({
        ...await window.desktop.openWorkspaceFile({ workspaceId, entryId: item.entryId }), jumpLine: item.line,
      })); }); row.append(button); document.getElementById('search-results').append(row);
    }
  } catch (error) { if (searchId === id) bindUi(document.getElementById('search-status'), "检索失败：{0}", error.message); }
  finally { if (searchId === id) { searchId = null; controls(); } }
});
async function applyLocale() {
  const locale = await globalThis.platform.settings.get('preferredLocale');
  await globalThis.platform.i18n.setLocale(locale);
  const language = globalThis.platform.i18n.getUILanguage();
  document.documentElement.lang = language.replace('_', '-');
  document.getElementById('locale').value = locale;
  window.desktopViewer.applyDesktopUi();
  updateThemeLabels();
  if (editState) document.getElementById('filename').textContent = uiFilename(editState);
  if (tabItems.length) updateTabs(tabItems, activeId);
  fileStatus();
  document.dispatchEvent(new Event('desktop:locale-changed'));
}
function updateThemeLabels() {
  if (!settingsDefinition) return;
  const chinese = globalThis.platform.i18n.getUILanguage() === 'zh_CN';
  const select = document.getElementById('setting-themeId');
  for (const [index, theme] of settingsDefinition.themes.entries()) {
    select.options[index].textContent = chinese ? theme.name : theme.name_en || theme.name;
  }
}
const settingControls = {
  themeId: { group: 'document', label: '文档主题' },
  frontmatterDisplay: { group: 'document', label: 'Frontmatter', options: ['隐藏', '表格', '源码'] },
  tableLayout: { group: 'document', label: '表格对齐', options: ['左对齐', '居中', '居中并铺满'] },
  imageLayout: { group: 'document', label: '图片对齐', options: ['左对齐', '居中'] },
  diagramLayout: { group: 'document', label: '图表对齐', options: ['左对齐', '居中'] },
  tableMergeEmpty: { group: 'document', label: '合并表格空单元格' },
  firstLineIndent: { group: 'document', label: '首行缩进（字符）' },
  docxHrDisplay: { group: 'export', label: '分隔线显示', options: ['分页', '横线', '隐藏'] },
  docxEmojiStyle: { group: 'export', label: 'Emoji 字体', options: ['Apple', 'Windows', '跟随系统'] },
  swapPanelSide: { group: 'sidebar', label: '文件侧栏显示在右侧' },
  readerSidebarWidth: { group: 'sidebar', label: '侧栏宽度（px）' },
};
function showSettingValues(values) {
  for (const field of document.querySelectorAll('[data-setting-key]')) {
    const value = values[field.dataset.settingKey];
    if (field.type === 'checkbox') field.checked = value;
    else field.value = value;
  }
}
function applySidebarSettings(values) {
  const app = document.getElementById('desktop-app');
  app.dataset.sidebarSide = values.swapPanelSide ? 'right' : 'left';
  app.style.setProperty('--desktop-sidebar-width', `${values.readerSidebarWidth}px`);
}
async function initializeSettingsForm() {
  const definition = await window.desktopViewer.settingsForm();
  for (const rule of definition.rules.filter(item => item.key !== 'preferredLocale')) {
    const info = settingControls[rule.key];
    if (!info) throw Error(ui("缺少设置控件：{0}", rule.key));
    const label = document.createElement('label');
    const caption = document.createElement('span');
    bindUi(caption, info.label);
    const field = document.createElement(rule.type === 'enum' || rule.key === 'themeId' ? 'select' : 'input');
    field.dataset.settingKey = rule.key;
    field.id = `setting-${rule.key}`;
    if (rule.type === 'enum') {
      rule.values.forEach((value, index) => {
        const option = new Option('', value);
        bindUi(option, info.options[index]);
        field.add(option);
      });
    } else if (rule.key === 'themeId') {
      for (const theme of definition.themes) field.add(new Option(theme.name, theme.id));
    } else if (rule.type === 'boolean') {
      field.type = 'checkbox';
      label.className = 'shell-check';
    } else {
      field.type = 'number'; field.min = rule.min; field.max = rule.max; field.step = 'any'; field.required = true;
    }
    if (field.type === 'checkbox') label.append(field, caption);
    else label.append(caption, field);
    document.getElementById(`settings-${info.group}-fields`).append(label);
  }
  settingsDefinition = definition;
  updateThemeLabels();
  showSettingValues(definition.values);
  applySidebarSettings(definition.values);
  bindUi(document.getElementById('settings-status'), "文档、Word 导出与侧栏设置修改后，点击“应用并保存”。");
}
document.addEventListener('desktop:settings-open', async () => {
  if (!settingsDefinition) return;
  settingsLoading = true; controls();
  try { showSettingValues(await globalThis.platform.settings.getAll()); }
  catch (error) { bindUi(document.getElementById('settings-status'), "读取设置失败：{0}", error.message); }
  finally { settingsLoading = false; controls(); }
});
document.getElementById('settings-reset').addEventListener('click', () => {
  showSettingValues(Object.fromEntries(settingsDefinition.rules.map(rule => [rule.key, rule.default])));
  bindUi(document.getElementById('settings-status'), "已填入默认值，点击“应用并保存”生效。");
});
document.getElementById('settings-apply').addEventListener('click', () => {
  const fields = [...document.querySelectorAll('[data-setting-key]')];
  if (!fields.every(field => field.reportValidity())) return;
  const values = Object.fromEntries(fields.map(field => [field.dataset.settingKey,
    field.type === 'checkbox' ? field.checked : field.type === 'number' ? field.valueAsNumber : field.value]));
  void navigate(async () => {
    try {
      await window.desktopViewer.saveSettings(values);
      applySidebarSettings(values);
      bindUi(document.getElementById('settings-status'), "设置已保存。");
      return editState ? window.desktop.activate(editState.documentId) : null;
    } catch (error) {
      bindUi(document.getElementById('settings-status'), "保存设置失败：{0}", error.message);
      throw error;
    }
  });
});
document.getElementById('locale').addEventListener('change', async event => {
  event.target.disabled = true;
  try { await globalThis.platform.settings.set('preferredLocale', event.target.value); await applyLocale(); }
  catch (error) { bindUi(status, "语言加载失败：{0}", error.message); }
  finally { event.target.disabled = false; }
});
const cacheStatsButton = document.getElementById('cache-stats-button');
const clearCacheButton = document.getElementById('clear-cache');
async function updateCacheInfo(clear = false) {
  const cache = globalThis.platform.cache;
  const cacheStatus = document.getElementById('cache-status');
  cacheStatsButton.disabled = clearCacheButton.disabled = true;
  try {
    if (clear && !await cache.clear()) {
      bindUi(cacheStatus, '清理缓存失败');
      return;
    }
    const stats = await cache.getStats();
    if (stats) bindUi(cacheStatus, '缓存：{0} 项，{1} MiB', stats.itemCount, stats.totalSizeMB);
    else bindUi(cacheStatus, '缓存信息不可用');
  } finally {
    cacheStatsButton.disabled = clearCacheButton.disabled = false;
  }
}
cacheStatsButton.addEventListener('click', () => { void updateCacheInfo(); });
clearCacheButton.addEventListener('click', () => { void updateCacheInfo(true); });
void window.desktopViewer.init().then(async () => {
  const select = document.getElementById('locale');
  for (const item of window.desktopViewer.locales()) {
    const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; select.append(option);
  }
  await applyLocale();
  await initializeSettingsForm();
  const session = await window.desktop.session();
  for (const workspace of session.workspaces) {
    try { await showWorkspace(workspace); } catch (error) { session.warnings.push(ui("目录加载失败：{0}", error.message)); }
  }
  updateTabs(session.tabs, session.selected?.documentId || null);
  opening = false;
  if (session.selected) await navigate(async () => session.selected);
  document.getElementById('session-status').textContent = session.warnings.join('\n');
  await refreshRecent();
}).catch(error => { bindUi(status, "初始化失败：{0}", error.message); }).finally(() => {
  booting = false; opening = false; controls(); void refreshChangedFile();
  void drainExternalOpens();
});
async function exportDocument(format, assets, pdf) {
    const isAssets = format === 'assets';
    const selected = isAssets ? editState : request;
    if (exporting || opening || !selected || (isAssets ? !assetsCurrent() : selected.readOnly && !selected.diagramType && !(selected.slidev && format === 'pdf' && window.desktopViewer.slideStatus()?.issues === 0))) return;
    exporting = true; controls();
    const label = isAssets ? ui('文档资产') : format.toUpperCase();
    lastTask = { filename:uiFilename(selected), format:label, state:'running', message:ui("正在准备 {0}…", label) };
    bindUi(status, "正在准备 {0}…", label);
    try {
      exportPromise = window.desktop.exportDocument({ format, assets, documentId: selected.documentId, documentVersion: selected.documentVersion, ...pdf });
      const result = await exportPromise;
      if (result?.canceled) bindUi(status, '已取消导出');
      else if (isAssets && result.count) bindUi(status, '已保存 {0} 项资产：{1}（{2} 项不可用）', result.count, result.path, result.failed.length);
      else if (isAssets) bindUi(status, '没有可写出的资产（{0} 项不可用）', result.failed.length);
      else bindUi(status, '已保存：{0}（{1} 字节，来源：{2}）', result.path, result.bytes, uiFilename(selected));
      lastTask.state = result?.canceled ? 'canceled' : isAssets && !result.count ? 'failed' : 'complete';
      return result;
    } catch (error) { lastTask.state = 'failed'; bindUi(status, "操作失败：{0}", error.message || error); }
    finally { lastTask.message = status.textContent; exportPromise = null; exporting = false; controls(); }
}

const assetField = id => document.getElementById(`asset-${id}`);
function visibleAssets() {
  const kind = assetField('kind').value, index = assetField('index').value, line = assetField('line').value;
  return assetRows.filter(item => (!kind || item.kind === kind) && (!index || item.index === Number(index)) && (!line || item.line === Number(line)));
}
function assetControls() {
  const selected = visibleAssets().filter(item => item.selected && !item.error);
  const valid = assetView === editState && assetsCurrent();
  assetField('save').disabled = exporting || !valid || !selected.length || selected.length > 500;
  assetField('select').disabled = exporting || !valid;
  assetField('clear').disabled = exporting || !valid;
  assetField('cancel').hidden = !exporting || !assetMessage;
  bindUi(assetField('count'), selected.length > 500 ? '每次可导出 1 至 500 项资产' : '显示 {0} 项 · 选中 {1} 项', visibleAssets().length, selected.length);
}
function renderAssetRows() {
  assetField('rows').replaceChildren(...visibleAssets().map(item => {
    const row = document.createElement('li'); row.dataset.index = item.index; row.dataset.kind = item.kind;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = item.selected && !item.error; check.disabled = Boolean(item.error);
    bindUiAttribute(check, 'aria-label', '选择资产 {0}', item.index);
    check.onchange = () => { item.selected = check.checked; assetControls(); };
    const label = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = `${item.index}. ${item.kind === 'image' ? ui('图片') : item.type}${item.alt ? ' · ' + item.alt : ''}`;
    const detail = document.createElement('span'); detail.textContent = [item.line ? ui('第 {0} 行', item.line) : '', item.width && item.height ? `${item.width} × ${item.height}` : ''].filter(Boolean).join(' · ');
    label.append(name, detail);
    if (item.error) { const message = document.createElement('span'); message.className = 'asset-error'; message.textContent = item.error; label.append(message); }
    row.append(check, label);
    if (!item.error) {
      const select = document.createElement('select');
      bindUiAttribute(select, 'aria-label', '资产 {0} 的导出格式', item.index);
      for (const format of item.formats) {
        const option = document.createElement('option'); option.value = format; option.textContent = format === 'original' ? ui('原格式') : format === 'drawio' ? 'DrawIO' : format.toUpperCase(); select.append(option);
      }
      select.value = item.format; select.onchange = () => { item.format = select.value; }; row.append(select);
    }
    return row;
  }));
  assetControls();
}
async function loadAssets() {
  const selected = editState;
  assetRows = []; assetView = null; assetMessage = '';
  for (const id of ['kind','index','line']) assetField(id).value = '';
  bindUi(assetField('status'), '正在读取资产清单…'); renderAssetRows();
  try {
    const rows = await window.desktopViewer.listAssets(selected);
    if (editState !== selected || !assetField('dialog').open) return;
    assetRows = rows.map(item => ({ ...item, selected: !item.error, format: item.formats[0] }));
    assetView = selected;
    if (rows.length) bindUi(assetField('status'), '{0} 项不可用', rows.filter(item => item.error).length);
    else bindUi(assetField('status'), '当前文档没有图片或图表');
    renderAssetRows();
  } catch (error) { bindUi(assetField('status'), '操作失败：{0}', error.message); }
}
for (const id of ['kind','index','line']) assetField(id).addEventListener('input', renderAssetRows);
for (const [id, selected] of [['select', true], ['clear', false]]) assetField(id).onclick = () => {
  for (const item of visibleAssets()) item.selected = selected && !item.error;
  renderAssetRows();
};
assetField('cancel').onclick = () => { void window.desktop.cancelExport(); };
assetField('save').onclick = async () => {
  const view = assetView;
  const selected = visibleAssets().filter(item => item.selected && !item.error).map(({ index, key, format }) => ({ index, key, format }));
  assetMessage = 'running';
  bindUi(assetField('status'), '正在导出所选资产…');
  const result = await exportDocument('assets', selected);
  assetMessage = '';
  if (view === assetView) {
    assetField('status').textContent = status.textContent;
    for (const failure of result?.failed || []) {
      const row = assetRows.find(item => item.index === failure.index);
      if (row) row.error = failure.error;
    }
    renderAssetRows();
  }
};
window.desktopApp = {
  closeTabs,
  revealWorkspaceFile,
  state:() => ({ document:editState, tabs:tabItems, busy:opening || booting, dirty:editorDirty(), exporting, task:lastTask,
    preview:{running:previewRunning,live:livePreview,synchronized:scrollSync,current:matchedPreview()} }),
  configurePreview:preferences => {
    if(typeof preferences.livePreview==='boolean' && preferences.livePreview!==livePreview) {
      livePreview=preferences.livePreview;
      if(!livePreview) {cancelPreview();if(previewRunning||!matchedPreview())bindUi(status, "实时预览已关闭，可手动更新。");}
      else {attemptedGeneration=-1;schedulePreview();}
    }
    if(typeof preferences.scrollSync==='boolean')scrollSync=preferences.scrollSync;
  },
  activate:activateTab,
  openRecent:id => navigate(() => window.desktop.openRecent(id)),
  export:exportDocument,
  loadAssets,
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
  bindUi(document.getElementById('book-status'), "正在读取章节目录…");
  try{
    if(!editState||editState.untitled||editState.readOnly)throw Error(ui("请先打开已保存的本机文档。"));
    await flushEditor();
    if(opening||epoch!==bookEpoch||id!==editState?.documentId)return;
    const result=await window.desktop.summaryIndex({documentId:id});
    if(epoch!==bookEpoch||id!==editState?.documentId)return;
    const parsed=window.desktopViewer.summaryTree(result.markdown);
    book=result;bookEntries=[];bookChosen=-1;
    const render=entries=>{
      const list=document.createElement('ul');
      for(const entry of entries){
        const row=document.createElement('li'),label=document.createElement(entry.href?'button':'span');label.textContent=entry.label||ui("未命名章节");
        if(entry.href){
          const index=bookEntries.length;bookEntries.push(entry);label.className='book-entry';
          label.addEventListener('click',()=>{void openChapter(index);});
        }else label.className='book-group';
        row.append(label);if(entry.children.length)row.append(render(entry.children));list.append(row);
      }
      return list;
    };
    document.getElementById('book-tree').replaceChildren(render(parsed.entries));
    bindUi(document.getElementById('book-status'), "{0} 个章节{1}{2}", bookEntries.length, parsed.truncated?ui(" · 目录已达显示上限"):'', bookEntries.length?'':ui(" · SUMMARY 中没有列表章节"));
    syncBook();
  }catch(error){
    if(epoch!==bookEpoch||id!==editState?.documentId)return;
    book=null;bookEntries=[];bookChosen=-1;document.getElementById('book-tree').replaceChildren();
    bindUi(document.getElementById('book-status'), "章节目录不可用：{0}", error.message);syncBook();
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
  if(!matchedPreview()) {bindUi(status, "预览尚未更新，暂不能定位；请等待或点击“更新预览”。");return;}
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
  if(!matchedPreview()){bindUi(status, "请先更新预览再打开文档链接。");return;}
  void navigate(()=>window.desktop.openLocalLink({documentId:editState.documentId,documentVersion:editState.documentVersion,href}));
});
