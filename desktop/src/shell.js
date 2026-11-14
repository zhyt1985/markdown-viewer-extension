/* Application-shell composition. Real document operations remain in renderer.js/host services. */
(() => {
  const app = document.getElementById('desktop-app');
  const popover = document.getElementById('shell-popover');
  let menuButton, lastDialogTrigger, format = 'pdf', quickItems = [], appearance = 'light', outlineOpen = true;
  let inspectorSection = 'outline';
  const zoomSteps = [0.25, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  let readingPreferences=null,readingDefaults=null;
  let contextTabId=null;
  let readerContext, readerActionPending = false;
  const imageMenuSection = popover.querySelector('[data-shell-menu="image"]');
  const tableMenuSection = popover.querySelector('[data-shell-menu="table"]');
  const fontInputs={latin:'reader-font-latin',cjk:'reader-font-cjk',mono:'reader-font-mono',size:'reader-font-size',lineHeight:'reader-font-line-height'};
  function readFontForm(){return Object.fromEntries(Object.entries(fontInputs).map(([key,id])=>[key,['size','lineHeight'].includes(key)?Number(document.getElementById(id).value):document.getElementById(id).value.trim()]));}
  function showFontForm(font){
    if(!font)return;
    for(const [key,id] of Object.entries(fontInputs))document.getElementById(id).value=font[key];
    window.desktopViewer.previewReadingFont(font);
  }
  const api = () => window.desktopApp;
  const viewer = window.desktopViewer;
  const { ui, bindUi, uiSource, uiFilename } = viewer;
  const pdfPreview = window.createDesktopPdfPreview(api, bindUi);
  function canAdjustReading() {
    const state = api().state();
    return !state.busy && state.preview.current && !state.document?.html && app.dataset.mode !== 'source';
  }
  function syncReading() {
    const { layoutMode, zoom } = viewer.readingView();
    const button = document.getElementById('reading-open');
    button.textContent = `${Math.round(zoom * 100)}%`;
    button.disabled = !canAdjustReading();
    document.getElementById('reading-zoom-in').disabled = zoom >= zoomSteps.at(-1);
    document.getElementById('reading-zoom-out').disabled = zoom <= zoomSteps[0];
    document.querySelectorAll('[data-reading-layout]').forEach(item => {
      item.setAttribute('aria-checked', String(item.dataset.readingLayout === layoutMode));
    });
  }
  function changeZoom(direction) {
    if (!canAdjustReading()) return;
    const { zoom } = viewer.readingView();
    const next = direction > 0 ? zoomSteps.find(step => step > zoom)
      : direction < 0 ? zoomSteps.findLast(step => step < zoom) : 1;
    if (next !== undefined && next !== zoom) return viewer.setReadingView({ zoom: next });
  }
  function showActionError(error) {
    bindUi(document.getElementById('status'), "操作失败：{0}", error.message);
  }
  function showFullscreen(active) {
    const button = document.getElementById('fullscreen-toggle');
    bindUi(button.querySelector('[data-ui-text]'), active ? '退出全屏' : '进入全屏');
    button.setAttribute('aria-pressed', String(active));
  }
  const paths = {
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>',
    clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    save:'<path d="M4 3h13l4 4v14H3V3Zm3 0v6h9V3M7 21v-8h10v8"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    settings:'<path d="M9 3h6l1 3 3 2 2 3-2 3-1 4-3 1-1 3h-4l-1-3-3-1-2-4-2-3 2-3 3-2Z"/><circle cx="12" cy="12" r="3"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
    expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  document.querySelectorAll('[data-shell-icon]').forEach(node => { node.innerHTML = `<svg class="shell-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[node.dataset.shellIcon]}</svg>`; });
  function closeMenu(restore = false) {
    popover.hidden = true; menuButton?.setAttribute('aria-expanded', 'false');
    readerContext = undefined;
    if (restore && menuButton?.isConnected) menuButton.focus({ preventScroll: true });
  }
  function menu(name, button, position) {
    if (!popover.hidden && menuButton === button) { closeMenu(true); return; }
    closeMenu(); menuButton = button;
    popover.querySelectorAll('[data-shell-menu]').forEach(node => { node.hidden = node.dataset.shellMenu !== name; });
    popover.hidden = false; button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(position?.x??rect.left, innerWidth - popover.offsetWidth - 8))}px`;
    popover.style.top = `${Math.max(8,Math.min(position?.y??(rect.bottom+5), innerHeight - popover.offsetHeight - 8))}px`;
    popover.querySelector('[data-shell-menu]:not([hidden]) button:not([hidden]):not(:disabled)')?.focus({ preventScroll: true });
  }
  function tabMenu(tab,position) {
    const state=api().state();if(state.busy||document.querySelector('dialog[open]'))return;
    const id=tab.dataset.documentId;if(!state.tabs.some(item=>item.documentId===id))return;
    contextTabId=id;closeMenu();
    document.getElementById('tab-close-others').disabled=state.tabs.length<=1;
    menu('tabs',tab.querySelector('.tab-open'),position);
  }
  document.getElementById('tabs').addEventListener('contextmenu',event=>{
    const tab=event.target.closest('.document-tab');if(!tab)return;
    event.preventDefault();tabMenu(tab,{x:event.clientX,y:event.clientY});
  });
  document.getElementById('tabs').addEventListener('scroll',()=>closeMenu(),{passive:true});
  function readerContextReady() {
    const state = api().state();
    return !state.busy && !state.exporting && !state.preview.running && state.preview.current && app.dataset.mode !== 'source';
  }
  function imageMenu(target, position) {
    const anchor = target.closest('img, .desktop-diagram-open, #markdown-content a[href]');
    const image = anchor?.matches('img') ? anchor
      : anchor?.matches('.desktop-diagram-open') ? anchor.closest('.diagram-block')?.querySelector('img')
      : anchor?.childElementCount === 1 && anchor.firstElementChild.matches('img') ? anchor.firstElementChild : null;
    if (!image?.closest('#reader')) return false;
    const selected = api().state().document;
    const formats = viewer.imageContext(image, selected);
    if (!formats) return false;
    closeMenu();
    for (const button of imageMenuSection.querySelectorAll('button')) {
      button.hidden = button.dataset.imageAction !== 'copy' && !formats.includes(button.dataset.imageAction);
    }
    menu('image', image.closest('.diagram-block')?.querySelector('.desktop-diagram-open') || anchor, position);
    readerContext = { kind: 'image', element: image, selected };
    return true;
  }
  function tableMenu(target, position) {
    if (target.closest('img, .desktop-diagram-open')) return false;
    const table = target.closest('#markdown-content table') ||
      (target.matches('.desktop-table-scroll') ? target.querySelector(':scope > table') : null);
    const selected = api().state().document;
    if (!table || !viewer.tableContext(table, selected)) return false;
    closeMenu();
    menu('table', table.closest('.desktop-table-scroll'), position);
    readerContext = { kind: 'table', element: table, selected };
    return true;
  }
  function readerMenu(target, position) {
    return !readerActionPending && readerContextReady() && !document.querySelector('dialog[open]')
      && (imageMenu(target, position) || tableMenu(target, position));
  }
  const reader = document.getElementById('reader');
  reader.addEventListener('contextmenu', event => {
    if (readerMenu(event.target, { x: event.clientX, y: event.clientY })) event.preventDefault();
  });
  reader.addEventListener('scroll', () => {
    if (readerContext) closeMenu();
  }, { capture: true, passive: true });
  async function runReaderAction(context, choice) {
    if (!context || readerActionPending || !readerContextReady() || api().state().document !== context.selected) return;
    readerActionPending = true;
    const table = context.kind === 'table';
    const status = document.getElementById('status');
    bindUi(status, table ? '正在读取表格…' : '正在读取图片…');
    try {
      const result = await (table ? viewer.tableAction(context.element, context.selected, choice)
        : viewer.imageAction(context.element, context.selected, choice));
      if (api().state().document !== context.selected) return;
      if (result.copied) bindUi(status, table ? '已将表格复制到剪贴板' : '已将图片复制到剪贴板');
      else if (result.path) bindUi(status, table ? '已保存表格：{0}' : '已保存图片：{0}', result.path);
      else if (result.canceled) bindUi(status, '已取消导出');
    } catch (error) {
      if (api().state().document === context.selected) showActionError(error);
    } finally { readerActionPending = false; }
  }
  window.addEventListener('blur',()=>closeMenu());
  function dialog(id) {
    if(id==='settings-dialog'){
      showFontForm(readingPreferences);
      document.dispatchEvent(new Event('desktop:settings-open'));
    }
    closeMenu();
    document.querySelectorAll('dialog[open]').forEach(node => node.close());
    lastDialogTrigger = document.activeElement;
    const node = document.getElementById(id); node.showModal();
    (node.querySelector('[autofocus]') || node.querySelector('[data-shell-close]'))?.focus();
  }
  document.querySelectorAll('dialog').forEach(node => node.addEventListener('close', () => {
    const focused=document.activeElement;
    if (!document.querySelector('dialog[open]') && lastDialogTrigger?.isConnected
      && (!focused || focused===document.body || node.contains(focused))) lastDialogTrigger.focus();
  }));
  function nav(name) {
    closeMenu(); app.classList.remove('sidebar-hidden');
    if (innerWidth < 900) app.classList.add('sidebar-drawer');
    for (const section of ['files','search','recent','book']) document.getElementById(`${section}-panel`).hidden = name !== section;
    bindUi(document.getElementById('sidebar-title'), { files:'工作区', search:'检索', recent:'最近打开', book:'章节目录' }[name]);
    document.querySelectorAll('[data-shell-nav]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shellNav === name)));
    if (name === 'search') document.getElementById('search-query').focus();
  }
  function visibleMode(value) {
    return value === 'split' && innerWidth < 640 ? 'source' : value;
  }
  function mode(value) {
    const current = api().state().document;
    if (!current || current.readOnly || api().state().busy) return;
    const update = () => {
      viewer.rememberDocumentMode(value);
      sync();
      if (value !== 'reading') document.getElementById('markdown-editor').focus({ preventScroll: true });
    };
    if (app.dataset.mode !== visibleMode(value)) viewer.reflowReader(update);
    else update();
    void viewer.saveReadingState().catch(showActionError);
  }
  function sync() {
    const state = api().state(), current = state.document;
    const readOnly = Boolean(current?.readOnly);
    app.dataset.mode = current && !readOnly ? visibleMode(viewer.documentMode() || 'reading') : 'reading';
    document.getElementById('editor-pane').hidden = app.dataset.mode === 'reading';
    syncReading();
    document.getElementById('export-open').disabled = document.getElementById('pdf').disabled;
    document.querySelectorAll('[data-shell-mode]').forEach(button => {
      button.disabled = state.busy || !current || readOnly;
      button.setAttribute('aria-pressed', String(button.dataset.shellMode === app.dataset.mode));
    });
    document.querySelectorAll('[data-shell-action="outline"],[data-shell-action="annotations"]').forEach(button => {
      button.disabled = !current || state.busy || readOnly;
    });
    document.getElementById('welcome').hidden = Boolean(current);
    document.getElementById('markdown-page').hidden = !current;
    document.getElementById('workspace-empty').hidden = Boolean(document.querySelector('#workspaces section'));
    bindUi(document.getElementById('save-indicator'), current ? readOnly ? '只读' : current.draftError ? '暂存失败' : current.untitled ? '未命名 · 已暂存' : state.dirty ? current.draftSavedAt ? '草稿已暂存' : '未保存' : '已保存' : '就绪');
    document.getElementById('save-dot').classList.toggle('dirty', state.dirty);
    const encoding = document.querySelector('.shell-encoding');
    encoding.hidden = Boolean(current?.imageUrl);
    encoding.textContent = (current?.encoding || 'utf-8').toUpperCase();
    document.getElementById('file-status').classList.toggle('document-notice',Boolean(current?.untitled||current?.draftError||current?.recovered||current?.encodingWarning));
    document.getElementById('file-status').classList.toggle('untitled-hint',Boolean(current?.untitled&&!current?.draftError));
    const inspector = document.getElementById('inspector');
    inspector.hidden = !current || readOnly || !outlineOpen || app.dataset.mode !== 'reading';
    document.getElementById('annotations-open').setAttribute('aria-pressed', String(inspectorSection === 'annotations' && !inspector.hidden && getComputedStyle(inspector).display !== 'none'));
    document.querySelectorAll('[data-shell-action="focus"]').forEach(button => {
      button.disabled = !current || state.busy;
      button.setAttribute('aria-pressed', String(app.classList.contains('focus-mode')));
    });
    bindUi(document.getElementById('tasks-open'), state.exporting ? "正在导出…" : "导出任务");
    document.getElementById('task-description').textContent = state.task ? ui("{0} · {1} · 导出开始时的快照", state.task.filename, state.task.format.toUpperCase()) : ui("暂无正在执行的导出任务。");
    document.getElementById('task-result').textContent = state.task?.message || '';
    const status = document.getElementById('status'); status.title = status.textContent;
    const notice = document.getElementById('operation-status');
    notice.textContent = /失败|错误/.test(uiSource(status)) || /失败|错误|SAVE_CONFLICT/.test(status.textContent) ? status.textContent : '';
  }
  function outline() {
    const list = document.getElementById('outline-list'); list.replaceChildren();
    const headings = [...document.querySelectorAll('#markdown-content h1,#markdown-content h2,#markdown-content h3')];
    if (!headings.length) { const empty = document.createElement('p'); bindUi(empty, "这份文档还没有章节标题。"); list.append(empty); }
    headings.forEach(heading => {
      const button = document.createElement('button'); button.textContent = heading.textContent;
      button.style.paddingLeft = heading.tagName === 'H3' ? '24px' : heading.tagName === 'H2' ? '16px' : '8px';
      button.addEventListener('click', () => {
        const reader = document.getElementById('reader');
        reader.scrollTo({ top: reader.scrollTop + heading.getBoundingClientRect().top - reader.getBoundingClientRect().top - 24, behavior:'instant' });
        list.querySelectorAll('button').forEach(item => item.setAttribute('aria-current', String(item === button)));
      }); list.append(button);
    });
  }
  function showInspector(section, toggle = true) {
    const current = api().state().document;
    if (!current || current.readOnly) return;
    const pane = document.getElementById('inspector');
    const visible = !pane.hidden && getComputedStyle(pane).display !== 'none';
    viewer.reflowReader(() => {
      app.classList.remove('focus-mode');
      outlineOpen = !(toggle && visible && inspectorSection === section);
      inspectorSection = section;
      bindUi(document.getElementById('inspector-title'), section === 'outline' ? "本文目录" : "文档批注");
      document.getElementById('outline-list').hidden = section !== 'outline';
      document.getElementById('annotations-panel').hidden = section !== 'annotations';
      if (app.dataset.mode !== 'reading') mode('reading', false);
      pane.classList.toggle('inspector-drawer', innerWidth < 1280 && outlineOpen);
      sync();
    });
    if (section === 'outline') outline();
  }
  function setAppearance(value) {
    appearance = value;
    app.dataset.appearance = value === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : value;
    document.getElementById('appearance').value = value;
  }
  async function saveAppearance(value) { await window.desktop.preferences('set', { appearance:value }); setAppearance(value); }
  async function quick() {
    const tabs = api().state().tabs, recent = await window.desktop.recent();
    quickItems = [...tabs.map(item => ({ ...item, open:() => api().activate(item.documentId) })), ...recent.filter(item => !tabs.some(tab => tab.documentPath === item.documentPath)).map(item => ({ ...item, open:() => api().openRecent(item.id) }))];
    document.getElementById('quick-query').value = ''; fillQuick(''); dialog('quick-dialog');
  }
  function fillQuick(query) {
    const list = document.getElementById('quick-results'); list.replaceChildren();
    const matches = quickItems.filter(item => uiFilename(item).toLowerCase().includes(query.toLowerCase()));
    for (const item of matches) {
      const button = document.createElement('button'), name = document.createElement('strong'), location = document.createElement('span');
      name.textContent = uiFilename(item); location.textContent = item.untitled?ui("未命名草稿 · 尚未保存到文件"):item.documentPath; button.append(name,location);
      button.addEventListener('click', () => { document.getElementById('quick-dialog').close(); void item.open(); }); list.append(button);
    }
    if (!matches.length) { const empty = document.createElement('p'); bindUi(empty, "没有匹配的已打开文件或最近记录。"); list.append(empty); }
  }
  const actions = {
    'tab-close-current':()=>api().closeTabs('current',contextTabId),
    'tab-close-others':()=>api().closeTabs('others',contextTabId),
    'tab-close-all':()=>api().closeTabs('all',contextTabId),
    'file-menu':button => menu('file',button), 'view-menu':button => menu('view',button), 'document-menu':button => menu('document',button),
    'reading-menu':button => menu('reading', button),
    'reading-zoom-in':() => changeZoom(1),
    'reading-zoom-out':() => changeZoom(-1),
    'reading-zoom-reset':() => changeZoom(0),
    'workspace-reveal': async () => {
      const target = await api().revealWorkspaceFile();
      if (!target?.isConnected) return;
      viewer.reflowReader(() => { app.classList.remove('focus-mode'); nav('files'); sync(); });
      target.scrollIntoView({ block:'nearest', inline:'nearest' });
      target.focus({ preventScroll:true });
    },
    fullscreen:() => window.desktop.fullscreen('toggle'),
    'open-file':() => document.getElementById('open').click(), 'open-workspace':() => { nav('files'); document.getElementById('open-workspace').click(); },
    'open-with-encoding':async () => {
      const encodings = await window.desktop.encodings();
      if (api().state().busy) return;
      const field = document.getElementById('open-encoding');
      const preferred = field.value;
      field.replaceChildren(...encodings.map(({ id, name }) => new Option(name, id)));
      if (encodings.some(({ id }) => id === preferred)) field.value = preferred;
      dialog('encoding-dialog');
    },
    'new-document':()=>document.getElementById('new-document').click(),
    save:() => document.getElementById('save').click(), preview:() => document.getElementById('preview-draft').click(),
    sidebar:() => viewer.reflowReader(() => app.classList.toggle(innerWidth < 900 ? 'sidebar-drawer' : 'sidebar-hidden')),
    settings:() => dialog('settings-dialog'), tasks:() => { sync(); dialog('tasks-dialog'); }, shortcuts:() => dialog('help-dialog'),
    appearance:() => saveAppearance(app.dataset.appearance === 'dark' ? 'light' : 'dark'),
    focus:() => viewer.reflowReader(() => { app.classList.toggle('focus-mode'); sync(); }),
    start:() => { if (api().state().document) { document.getElementById('reader').scrollTo({ top:0, behavior:'instant' }); } else document.getElementById('welcome').focus(); },
    outline:() => showInspector('outline'),
    annotations:() => showInspector('annotations'),
    'inspector-close':() => viewer.reflowReader(() => { outlineOpen = false; sync(); }),
    'quick-open':quick,
    'resource-folders': () => dialog('resource-folders-dialog'),
    'document-assets': () => { dialog('asset-dialog'); void api().loadAssets(); },
    export:() => {
      const current = api().state().document; if (!current) return;
      document.getElementById('export-source').textContent = `${uiFilename(current)}${current.dirty ? ui(" · 包含未保存的编辑稿") : ''}`;
      if (current.slidev) format = 'pdf';
      syncExportChoices(current);
      dialog('export-dialog');
    },
  };
  function syncExportChoices(current) {
    const slide = Boolean(current?.slidev);
    document.querySelectorAll('[data-export-format]').forEach(item => {
      item.hidden = slide && item.dataset.exportFormat !== 'pdf';
      item.setAttribute('aria-pressed', String(item.dataset.exportFormat === format));
    });
    document.getElementById('export-slidev-note').hidden = !slide;
    pdfPreview.sync(format === 'pdf' ? current : null);
    document.getElementById('export-html-note').hidden = slide || format !== 'html';
    document.getElementById('export-png-note').hidden = slide || format !== 'png';
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && (imageMenuSection.contains(button) || tableMenuSection.contains(button))) {
      const context = readerContext;
      closeMenu(true);
      void runReaderAction(context, button.dataset.imageAction || button.dataset.tableAction);
      return;
    }
    // The document controller may disable the clicked item before this event bubbles.
    // Consume the menu selection even in that state, so the next open doesn't toggle it closed.
    if (button && popover.contains(button)) closeMenu(Boolean(button.closest('[data-shell-menu="reading"]')));
    if (!button || button.disabled) { if (!popover.contains(event.target)) closeMenu(); return; }
    if (button.hasAttribute('data-shell-close')) { button.closest('dialog').close(); return; }
    if (button.dataset.exportFormat) { format = button.dataset.exportFormat; syncExportChoices(api().state().document); return; }
    if (button.id === 'export-start') {
      const pdf = format === 'pdf' ? pdfPreview.selection() : undefined;
      document.getElementById('export-dialog').close();
      void api().export(format, undefined, pdf);
      return;
    }
    if (button.dataset.readingLayout) {
      if (canAdjustReading()) void viewer.setReadingView({ layoutMode: button.dataset.readingLayout }).catch(showActionError);
      return;
    }
    if (button.dataset.shellMode) { mode(button.dataset.shellMode); return; }
    if (button.dataset.shellNav) { closeMenu(); nav(button.dataset.shellNav); return; }
    const action = button.dataset.shellAction;
    if (action) { if (!action.endsWith('-menu')) closeMenu(); Promise.resolve(actions[action]?.(button)).catch(showActionError); return; }
    if (popover.contains(button) || !popover.contains(event.target)) closeMenu();
  });
  document.getElementById('appearance').addEventListener('change', event => { void saveAppearance(event.target.value).catch(error => { bindUi(document.getElementById('status'), "设置失败：{0}", error.message); }); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (appearance === 'system') setAppearance('system'); });
  document.getElementById('quick-query').addEventListener('input', event => fillQuick(event.target.value));
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !popover.hidden && (readerContext || !popover.querySelector('[data-shell-menu="tabs"]').hidden)) closeMenu(true);
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const tab = event.target.closest('.document-tab');
      if (tab) { event.preventDefault(); tabMenu(tab); return; }
      if (readerMenu(event.target)) { event.preventDefault(); return; }
    }
    if (event.key === 'Escape') {
      if (!popover.hidden) { event.preventDefault(); closeMenu(true); }
      else if (!document.querySelector('dialog[open]') && app.matches('.focus-mode,.sidebar-drawer')) {
        viewer.reflowReader(() => { app.classList.remove('focus-mode','sidebar-drawer'); sync(); });
      }
      return;
    }
    const tabs = event.target.closest('#tabs');
    if (tabs && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      const buttons = [...tabs.querySelectorAll('.tab-open')], index = buttons.indexOf(event.target);
      if (index >= 0) { event.preventDefault(); const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]; const id = next.closest('.document-tab').dataset.documentId; void api().activate(id).then(() => document.querySelector(`.document-tab[data-document-id="${id}"] .tab-open`)?.focus()); } return;
    }
    if (!popover.hidden && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...popover.querySelectorAll('[data-shell-menu]:not([hidden]) button:not([hidden]):not(:disabled)')], current = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; buttons[next]?.focus(); return;
    }
    if (document.getElementById('quick-dialog').open && ['ArrowDown','ArrowUp','Enter'].includes(event.key)) {
      const buttons = [...document.querySelectorAll('#quick-results button')], current = buttons.indexOf(document.activeElement);
      if (event.key === 'Enter' && event.target.id === 'quick-query') { event.preventDefault(); buttons[0]?.click(); }
      else if (event.key !== 'Enter') { event.preventDefault(); buttons[(current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'F11' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) void actions.fullscreen().catch(showActionError);
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (['+','=','-','0'].includes(event.key) && canAdjustReading()
        && !event.target.closest('#editor-pane,input,textarea,select,[contenteditable]')) {
      event.preventDefault();
      Promise.resolve(changeZoom(event.key === '0' ? 0 : event.key === '-' ? -1 : 1)).catch(showActionError);
      return;
    }
    const key = event.key.toLowerCase();
    const commands = { o:actions['open-file'], k:quick, b:actions.sidebar, ',':actions.settings, f:() => { if (event.shiftKey) nav('search'); } };
    if (commands[key] && (key !== 'f' || event.shiftKey)) { event.preventDefault(); commands[key](); }
  });
  window.addEventListener('resize', () => {
    closeMenu();
    document.getElementById('inspector').classList.remove('inspector-drawer');
    if (!api().state().document?.readOnly && viewer.documentMode() === 'split' && app.dataset.mode !== visibleMode('split')) viewer.reflowReader(sync);
  });
  document.addEventListener('desktop:changed',()=>{
    if (readerContext && (!readerContextReady() || api().state().document !== readerContext.selected
        || !readerContext.element.isConnected)) closeMenu();
    if(!popover.hidden&&!popover.querySelector('[data-shell-menu="tabs"]').hidden){
      const state=api().state();
      if(state.busy||!state.tabs.some(item=>item.documentId===contextTabId))closeMenu();
      else {menuButton=document.querySelector(`.document-tab[data-document-id="${contextTabId}"] .tab-open`);menuButton?.setAttribute('aria-expanded','true');document.getElementById('tab-close-others').disabled=state.tabs.length<=1;}
    }
    sync();
  });
  document.addEventListener('desktop:rendered',() => { if (readerContext) closeMenu(); sync(); outline(); });
  document.addEventListener('desktop:locale-changed', sync);
  document.addEventListener('desktop:reading-view', syncReading);
  window.desktop.onFullscreen(showFullscreen);
  void window.desktop.fullscreen('get').then(showFullscreen).catch(showActionError);
  const observer = new MutationObserver(sync);
  for (const id of ['status','file-status']) observer.observe(document.getElementById(id),{ childList:true,subtree:true });
  Promise.all([window.desktop.appInfo(),window.desktop.preferences('get')]).then(([info,prefs]) => {
    document.getElementById('app-version').textContent = `${info.productName} · ${info.version} · ${info.channel.toUpperCase()}`; setAppearance(prefs.appearance);
    document.getElementById('live-preview').checked=prefs.livePreview;
    document.getElementById('scroll-sync').checked=prefs.scrollSync;
    api().configurePreview(prefs);
    readingPreferences=prefs.readingFont;readingDefaults=prefs.readingFontDefaults;showFontForm(readingPreferences);
    document.getElementById('reader-font-apply').disabled=false;bindUi(document.getElementById('reader-font-status'), "可输入字体名称，或读取本机字体列表。");
  }).catch(error => { bindUi(document.getElementById('status'), "初始化失败：{0}", error.message); });
  for(const [id,key] of [['live-preview','livePreview'],['scroll-sync','scrollSync']]) document.getElementById(id).addEventListener('change',async event=>{
    const checkbox=event.target,value=checkbox.checked;checkbox.disabled=true;
    try {const prefs=await window.desktop.preferences('set',{[key]:value});api().configurePreview(prefs);}
    catch(error){checkbox.checked=!value;bindUi(document.getElementById('status'), "设置保存失败：{0}", error.message);}
    finally{checkbox.disabled=false;}
  });
  for(const id of Object.values(fontInputs))document.getElementById(id).addEventListener('input',()=>window.desktopViewer.previewReadingFont(readFontForm()));
  document.getElementById('reader-font-reset').addEventListener('click',()=>{showFontForm(readingDefaults);bindUi(document.getElementById('reader-font-status'), "已恢复推荐组合，点击“应用并保存”生效。");});
  document.getElementById('reader-font-apply').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const font=readFontForm();
      if(!['latin','cjk','mono'].every(key=>font[key].length>0&&font[key].length<=100&&/^[\p{L}\p{N} ._()+-]+$/u.test(font[key])))throw Error(ui("请输入有效的本机字体名称。"));
      if(!Number.isInteger(font.size)||font.size<12||font.size>28)throw Error(ui("正文字号应为 12–28 之间的整数。"));
      if(!Number.isFinite(font.lineHeight)||font.lineHeight<1.3||font.lineHeight>2.4)throw Error(ui("正文行高应在 1.3–2.4 之间。"));
      const prefs=await window.desktop.preferences('set',{readingFont:font});
      await window.desktopViewer.configureReadingFont(prefs.readingFont);readingPreferences=prefs.readingFont;
      bindUi(document.getElementById('reader-font-status'), "阅读字体已保存；本机未安装的字体将使用系统后备字体。");
    }catch(error){bindUi(document.getElementById('reader-font-status'), "未应用：{0}", error.message);}
    finally{button.disabled=false;}
  });
  document.getElementById('reader-font-load').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      if(typeof window.queryLocalFonts!=='function')throw Error(ui("当前系统无法列出字体，可直接输入已安装的字体名称。"));
      const fonts=await window.queryLocalFonts(),families=[...new Set(fonts.map(font=>font.family))].filter(name=>name.length<=100&&/^[\p{L}\p{N} ._()+-]+$/u.test(name)).sort((a,b)=>a.localeCompare(b));
      const list=document.getElementById('reader-font-families');list.replaceChildren();
      for(const family of families){const option=document.createElement('option');option.value=family;list.append(option);}
      bindUi(document.getElementById('reader-font-status'), "已读取 {0} 个本机字体，可在输入框中搜索选择。", families.length);
    }catch(error){document.getElementById('reader-font-status').textContent=error.message;}
    finally{button.disabled=false;}
  });
  window.desktopShell = { sync, mode, nav, closeMenu, showAnnotations:() => showInspector('annotations', false) };
  sync();
})();
