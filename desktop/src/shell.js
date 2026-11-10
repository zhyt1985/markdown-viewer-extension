/* Application-shell composition. Real document operations remain in renderer.js/host services. */
(() => {
  const app = document.getElementById('desktop-app');
  const popover = document.getElementById('shell-popover');
  let menuButton, lastDialogTrigger, format = 'pdf', quickItems = [], appearance = 'light', outlineOpen = true;
  let readingPreferences=null,readingDefaults=null;
  let contextTabId=null;
  const fontInputs={latin:'reader-font-latin',cjk:'reader-font-cjk',mono:'reader-font-mono',size:'reader-font-size',lineHeight:'reader-font-line-height'};
  function readFontForm(){return Object.fromEntries(Object.entries(fontInputs).map(([key,id])=>[key,['size','lineHeight'].includes(key)?Number(document.getElementById(id).value):document.getElementById(id).value.trim()]));}
  function showFontForm(font){
    if(!font)return;
    for(const [key,id] of Object.entries(fontInputs))document.getElementById(id).value=font[key];
    window.desktopViewer.previewReadingFont(font);
  }
  const api = () => window.desktopApp;
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
    if (restore && menuButton?.isConnected) menuButton.focus();
  }
  function menu(name, button, position) {
    if (!popover.hidden && menuButton === button) { closeMenu(true); return; }
    closeMenu(); menuButton = button;
    popover.querySelectorAll('[data-shell-menu]').forEach(node => { node.hidden = node.dataset.shellMenu !== name; });
    popover.hidden = false; button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(position?.x??rect.left, innerWidth - popover.offsetWidth - 8))}px`;
    popover.style.top = `${Math.max(8,Math.min(position?.y??(rect.bottom+5), innerHeight - popover.offsetHeight - 8))}px`;
    popover.querySelector('[data-shell-menu]:not([hidden]) button:not(:disabled)')?.focus();
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
  window.addEventListener('blur',()=>closeMenu());
  function dialog(id) {
    if(id==='settings-dialog')showFontForm(readingPreferences);
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
    document.getElementById('sidebar-title').textContent = { files:'工作区', search:'检索', recent:'最近打开',book:'章节目录' }[name];
    document.querySelectorAll('[data-shell-nav]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shellNav === name)));
    if (name === 'search') document.getElementById('search-query').focus();
  }
  function mode(value) {
    if (!api().state().document) return;
    if (value === 'split' && innerWidth < 640) value = 'source';
    app.dataset.mode = value;
    document.getElementById('editor-pane').hidden = value === 'reading';
    document.querySelectorAll('[data-shell-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shellMode === value)));
    if (value !== 'reading') { document.getElementById('inspector').hidden = true; document.getElementById('markdown-editor').focus(); }
    sync();
  }
  function sync() {
    const state = api().state(), current = state.document;
    document.getElementById('export-open').disabled = document.getElementById('pdf').disabled;
    document.querySelectorAll('[data-shell-mode]').forEach(button => { button.disabled = state.busy || !current; });
    document.getElementById('welcome').hidden = Boolean(current);
    document.getElementById('markdown-page').hidden = !current;
    document.getElementById('workspace-empty').hidden = Boolean(document.querySelector('#workspaces section'));
    document.getElementById('save-indicator').textContent = current ? current.draftError ? '暂存失败' : current.untitled ? '未命名 · 已暂存' : state.dirty ? current.draftSavedAt ? '草稿已暂存' : '未保存' : '已保存' : '就绪';
    document.getElementById('save-dot').classList.toggle('dirty', state.dirty);
    document.getElementById('file-status').classList.toggle('external-change', document.getElementById('file-status').textContent.includes('磁盘'));
    document.getElementById('file-status').classList.toggle('document-notice',Boolean(current?.untitled||current?.draftError||current?.recovered));
    document.getElementById('file-status').classList.toggle('untitled-hint',Boolean(current?.untitled&&!current?.draftError));
    document.getElementById('inspector').hidden = !current || !outlineOpen || app.dataset.mode !== 'reading';
    document.getElementById('tasks-open').textContent = state.exporting ? '正在导出…' : '导出任务';
    document.getElementById('task-description').textContent = state.task ? `${state.task.filename} · ${state.task.format.toUpperCase()} · 导出开始时的快照` : '暂无正在执行的导出任务。';
    document.getElementById('task-result').textContent = state.task?.message || '';
    if (!current) { document.getElementById('inspector').hidden = true; document.getElementById('editor-pane').hidden = true; app.dataset.mode = 'reading'; }
    const status = document.getElementById('status'); status.title = status.textContent;
    const notice = document.getElementById('operation-status');
    notice.textContent = /失败|SAVE_CONFLICT|错误/.test(status.textContent) ? status.textContent : '';
  }
  function outline() {
    const list = document.getElementById('outline-list'); list.replaceChildren();
    const headings = [...document.querySelectorAll('#markdown-content h1,#markdown-content h2,#markdown-content h3')];
    if (!headings.length) { const empty = document.createElement('p'); empty.textContent = '这份文档还没有章节标题。'; list.append(empty); }
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
    const matches = quickItems.filter(item => item.filename.toLowerCase().includes(query.toLowerCase()));
    for (const item of matches) {
      const button = document.createElement('button'), name = document.createElement('strong'), location = document.createElement('span');
      name.textContent = item.filename; location.textContent = item.untitled?'未命名草稿 · 尚未保存到文件':item.documentPath; button.append(name,location);
      button.addEventListener('click', () => { document.getElementById('quick-dialog').close(); void item.open(); }); list.append(button);
    }
    if (!matches.length) { const empty = document.createElement('p'); empty.textContent = '没有匹配的已打开文件或最近记录。'; list.append(empty); }
  }
  const actions = {
    'tab-close-current':()=>api().closeTabs('current',contextTabId),
    'tab-close-others':()=>api().closeTabs('others',contextTabId),
    'tab-close-all':()=>api().closeTabs('all',contextTabId),
    'file-menu':button => menu('file',button), 'view-menu':button => menu('view',button), 'document-menu':button => menu('document',button),
    'open-file':() => document.getElementById('open').click(), 'open-workspace':() => { nav('files'); document.getElementById('open-workspace').click(); },
    'new-document':()=>document.getElementById('new-document').click(),
    save:() => document.getElementById('save').click(), preview:() => document.getElementById('preview-draft').click(),
    sidebar:() => app.classList.toggle(innerWidth < 900 ? 'sidebar-drawer' : 'sidebar-hidden'),
    settings:() => dialog('settings-dialog'), tasks:() => { sync(); dialog('tasks-dialog'); }, shortcuts:() => dialog('help-dialog'),
    appearance:() => saveAppearance(app.dataset.appearance === 'dark' ? 'light' : 'dark'),
    focus:() => app.classList.toggle('focus-mode'),
    start:() => { if (api().state().document) { document.getElementById('reader').scrollTo({ top:0, behavior:'instant' }); } else document.getElementById('welcome').focus(); },
    outline:() => { if (!api().state().document) return; const pane = document.getElementById('inspector'); const visible = !pane.hidden && getComputedStyle(pane).display !== 'none'; outlineOpen = !visible; if (app.dataset.mode !== 'reading') mode('reading'); sync(); pane.classList.toggle('inspector-drawer',innerWidth < 1280); outline(); },
    'quick-open':quick,
    export:() => { const current = api().state().document; if (!current) return; document.getElementById('export-source').textContent = `${current.filename}${current.dirty ? ' · 包含未保存的编辑稿' : ''}`; dialog('export-dialog'); },
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    // The document controller may disable the clicked item before this event bubbles.
    // Consume the menu selection even in that state, so the next open doesn't toggle it closed.
    if (button && popover.contains(button)) closeMenu();
    if (!button || button.disabled) { if (!popover.contains(event.target)) closeMenu(); return; }
    if (button.hasAttribute('data-shell-close')) { button.closest('dialog').close(); return; }
    if (button.dataset.exportFormat) { format = button.dataset.exportFormat; document.querySelectorAll('[data-export-format]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.exportFormat === format))); return; }
    if (button.id === 'export-start') { document.getElementById('export-dialog').close(); void api().export(format); return; }
    if (button.dataset.shellMode) { mode(button.dataset.shellMode); return; }
    if (button.dataset.shellNav) { closeMenu(); nav(button.dataset.shellNav); return; }
    const action = button.dataset.shellAction;
    if (action) { if (!action.endsWith('-menu')) closeMenu(); Promise.resolve(actions[action]?.(button)).catch(error => { document.getElementById('status').textContent = `操作失败：${error.message}`; }); return; }
    if (popover.contains(button) || !popover.contains(event.target)) closeMenu();
  });
  document.getElementById('appearance').addEventListener('change', event => { void saveAppearance(event.target.value).catch(error => { document.getElementById('status').textContent = `设置失败：${error.message}`; }); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (appearance === 'system') setAppearance('system'); });
  document.getElementById('quick-query').addEventListener('input', event => fillQuick(event.target.value));
  document.addEventListener('keydown', event => {
    if(event.key==='Tab'&&!popover.hidden&&!popover.querySelector('[data-shell-menu="tabs"]').hidden)closeMenu(true);
    if((event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))&&event.target.closest('.document-tab')){
      event.preventDefault();tabMenu(event.target.closest('.document-tab'));return;
    }
    if (event.key === 'Escape') { if (!popover.hidden) { event.preventDefault(); closeMenu(true); } else if (!document.querySelector('dialog[open]')) { app.classList.remove('focus-mode','sidebar-drawer'); } return; }
    const tabs = event.target.closest('#tabs');
    if (tabs && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      const buttons = [...tabs.querySelectorAll('.tab-open')], index = buttons.indexOf(event.target);
      if (index >= 0) { event.preventDefault(); const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]; const id = next.closest('.document-tab').dataset.documentId; void api().activate(id).then(() => document.querySelector(`.document-tab[data-document-id="${id}"] .tab-open`)?.focus()); } return;
    }
    if (!popover.hidden && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...popover.querySelectorAll('[data-shell-menu]:not([hidden]) button:not(:disabled)')], current = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; buttons[next]?.focus(); return;
    }
    if (document.getElementById('quick-dialog').open && ['ArrowDown','ArrowUp','Enter'].includes(event.key)) {
      const buttons = [...document.querySelectorAll('#quick-results button')], current = buttons.indexOf(document.activeElement);
      if (event.key === 'Enter' && event.target.id === 'quick-query') { event.preventDefault(); buttons[0]?.click(); }
      else if (event.key !== 'Enter') { event.preventDefault(); buttons[(current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    const commands = { o:actions['open-file'], k:quick, b:actions.sidebar, ',':actions.settings, f:() => { if (event.shiftKey) nav('search'); } };
    if (commands[key] && (key !== 'f' || event.shiftKey)) { event.preventDefault(); commands[key](); }
  });
  window.addEventListener('resize', () => { closeMenu();document.getElementById('inspector').classList.remove('inspector-drawer'); if (innerWidth < 640 && app.dataset.mode === 'split') mode('source'); });
  document.addEventListener('desktop:changed',()=>{
    if(!popover.hidden&&!popover.querySelector('[data-shell-menu="tabs"]').hidden){
      const state=api().state();
      if(state.busy||!state.tabs.some(item=>item.documentId===contextTabId))closeMenu();
      else {menuButton=document.querySelector(`.document-tab[data-document-id="${contextTabId}"] .tab-open`);menuButton?.setAttribute('aria-expanded','true');document.getElementById('tab-close-others').disabled=state.tabs.length<=1;}
    }
    sync();
  });
  document.addEventListener('desktop:rendered',() => { sync(); outline(); });
  const observer = new MutationObserver(sync);
  for (const id of ['status','file-status']) observer.observe(document.getElementById(id),{ childList:true,subtree:true });
  Promise.all([window.desktop.appInfo(),window.desktop.preferences('get')]).then(([info,prefs]) => {
    document.getElementById('app-version').textContent = `${info.productName} · ${info.version} · ${info.channel.toUpperCase()}`; setAppearance(prefs.appearance);
    document.getElementById('live-preview').checked=prefs.livePreview;
    document.getElementById('scroll-sync').checked=prefs.scrollSync;
    api().configurePreview(prefs);
    readingPreferences=prefs.readingFont;readingDefaults=prefs.readingFontDefaults;showFontForm(readingPreferences);
    document.getElementById('reader-font-apply').disabled=false;document.getElementById('reader-font-status').textContent='可输入字体名称，或读取本机字体列表。';
  }).catch(error => { document.getElementById('status').textContent = `初始化失败：${error.message}`; });
  for(const [id,key] of [['live-preview','livePreview'],['scroll-sync','scrollSync']]) document.getElementById(id).addEventListener('change',async event=>{
    const checkbox=event.target,value=checkbox.checked;checkbox.disabled=true;
    try {const prefs=await window.desktop.preferences('set',{[key]:value});api().configurePreview(prefs);}
    catch(error){checkbox.checked=!value;document.getElementById('status').textContent=`设置保存失败：${error.message}`;}
    finally{checkbox.disabled=false;}
  });
  for(const id of Object.values(fontInputs))document.getElementById(id).addEventListener('input',()=>window.desktopViewer.previewReadingFont(readFontForm()));
  document.getElementById('reader-font-reset').addEventListener('click',()=>{showFontForm(readingDefaults);document.getElementById('reader-font-status').textContent='已恢复推荐组合，点击“应用并保存”生效。';});
  document.getElementById('reader-font-apply').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const font=readFontForm();
      if(!['latin','cjk','mono'].every(key=>font[key].length>0&&font[key].length<=100&&/^[\p{L}\p{N} ._()+-]+$/u.test(font[key])))throw Error('请输入有效的本机字体名称。');
      if(!Number.isInteger(font.size)||font.size<12||font.size>28)throw Error('正文字号应为 12–28 之间的整数。');
      if(!Number.isFinite(font.lineHeight)||font.lineHeight<1.3||font.lineHeight>2.4)throw Error('正文行高应在 1.3–2.4 之间。');
      const prefs=await window.desktop.preferences('set',{readingFont:font});
      await window.desktopViewer.configureReadingFont(prefs.readingFont);readingPreferences=prefs.readingFont;
      document.getElementById('reader-font-status').textContent='阅读字体已保存；本机未安装的字体将使用系统后备字体。';
    }catch(error){document.getElementById('reader-font-status').textContent=`未应用：${error.message}`;}
    finally{button.disabled=false;}
  });
  document.getElementById('reader-font-load').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      if(typeof window.queryLocalFonts!=='function')throw Error('当前系统无法列出字体，可直接输入已安装的字体名称。');
      const fonts=await window.queryLocalFonts(),families=[...new Set(fonts.map(font=>font.family))].filter(name=>name.length<=100&&/^[\p{L}\p{N} ._()+-]+$/u.test(name)).sort((a,b)=>a.localeCompare(b));
      const list=document.getElementById('reader-font-families');list.replaceChildren();
      for(const family of families){const option=document.createElement('option');option.value=family;list.append(option);}
      document.getElementById('reader-font-status').textContent=`已读取 ${families.length} 个本机字体，可在输入框中搜索选择。`;
    }catch(error){document.getElementById('reader-font-status').textContent=error.message;}
    finally{button.disabled=false;}
  });
  window.desktopShell = { sync, mode, nav, closeMenu };
  sync();
})();
