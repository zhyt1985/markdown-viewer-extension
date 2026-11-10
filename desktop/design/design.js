// Design review only: synthetic documents, no desktop bridge or filesystem access.
const app = document.getElementById('app');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const popover = document.getElementById('popover');
const editor = document.getElementById('source-editor');
const reader = document.getElementById('reader');
const article = document.getElementById('document-article');
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>',
  'folder-plus': '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/><path d="M12 10v6m-3-3h6"/>',
  file: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/>',
  'file-plus': '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M12 11v6m-3-3h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  save: '<path d="M4 3h13l4 4v14H3V3Zm3 0v6h9V3M7 21v-8h10v8"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  comment: '<path d="M4 4h16v12H9l-5 4Z"/><path d="M8 8h8m-8 4h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3 2-1 4 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-4 3-2 3-1Z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  type: '<path d="M3 5h14M10 5v15M6 20h8m2-5h6m-5 5 3-9 3 9"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'hard-drive': '<path d="m5 4-3 11v5h20v-5L19 4Z"/><path d="M2 15h20m-5 2.5h1"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`; }
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
icons();

const guide = `# 项目说明

一份面向日常工作的本地文档。把相关资料放在同一个工作区，让阅读、整理和分享自然衔接。

## 一、概览

这份工作区用于收集项目记录、设计笔记与参考资料。文件仍保留在自己的文件夹中，按熟悉的方式管理即可。

> 让目录服务于阅读，让格式服务于内容。

## 二、目录结构

- **项目文档**：项目说明、设计笔记与工作流程。
- **参考资料**：本地网页、示意图与配置示例。
- **SUMMARY.md**：为较长的内容提供章节导航。

## 三、工作流程

先整理资料，再补充观点和批注，最后根据用途选择导出格式。

\`\`\`mermaid
flowchart LR
  A[收集资料] --> B[整理内容] --> C[导出分享]
\`\`\`

## 四、格式与导出

导出只针对当前文档。表格和图表也可以单独复制或保存。

| 使用场景 | 推荐格式 | 内容特征 |
| --- | --- | --- |
| 后续修改 | Word 文档 | 可编辑公式、表格与正文 |
| 固定版式 | PDF 文档 | 便于阅读和归档 |
| 离线分享 | 单文件 HTML | 样式与本地资源一并嵌入 |

## 五、后续计划

为重要段落添加批注，用搜索找回相关内容。每次输出前检查图片和图表，保证分享出去的文档完整可读。

\`\`\`text
个人文档/
├─ 项目文档/
├─ 参考资料/
└─ SUMMARY.md
\`\`\`
`;
const initialFiles = {
  guide: { name: '项目说明.md', kind: 'markdown', folder: '项目文档', raw: guide },
  notes: { name: '设计笔记.md', kind: 'markdown', folder: '项目文档', raw: '# 设计笔记\n\n## 阅读体验\n\n保持文字清晰，减少不必要的干扰。\n\n## 导出检查\n\n导出前确认主题、图片和图表均已准备好。\n' },
  diagram: { name: '工作流程.mermaid', kind: 'diagram', folder: '项目文档', raw: 'flowchart LR\n  A[收集资料] --> B[整理内容] --> C[导出分享]' },
  slides: { name: '项目演示.slides.md', kind: 'slides', folder: '项目文档', raw: '# 本地文档工作流\n\n从收集到分享\n\n---\n\n# 阅读与整理\n\n让内容保持清晰。\n\n---\n\n# 输出与归档\n\n导出当前演示文档。' },
  html: { name: '参考页面.html', kind: 'html', folder: '参考资料', raw: '<h1>参考页面</h1>\n<p>这是一份保存在本机的参考资料。</p>' },
  image: { name: '示意图.svg', kind: 'image', folder: '参考资料', raw: '本地 SVG 图像示例' },
  code: { name: '配置示例.json', kind: 'code', folder: '参考资料', raw: '{\n  "language": "zh-CN",\n  "workspace": "个人文档",\n  "autoRefresh": true\n}' },
  summary: { name: 'SUMMARY.md', kind: 'summary', folder: '个人文档', raw: '# 目录\n\n- [项目说明](项目文档/项目说明.md)\n- [设计笔记](项目文档/设计笔记.md)\n' },
};
const files = structuredClone(initialFiles);
Object.values(files).forEach(file => { file.disk = file.raw; file.dirty = false; file.scroll = 0; file.sourceScroll = 0; });
const state = { active: 'guide', tabs: ['guide', 'notes'], nav: 'files', mode: 'reading', inspector: 'outline',
  conflict: false, refresh: true, workspace: true, recent: ['guide', 'notes', 'diagram'], tasks: [], format: 'pdf', slide: 0, annotations: [
    { id: 'a1', quote: '把相关资料放在同一个工作区', text: '同一个项目的资料放在一起，后续检索会更方便。', section: 0, color: 'yellow' },
    { id: 'a2', quote: '导出只针对当前文档', text: '交付前再核对一次图片和图表是否完整。', section: 3, color: 'blue' },
  ] };
let previousFocus, modalHandlers = {}, menuTrigger, toastTimer, editTimer, searchTimer, searchGeneration = 0, draftTimer;
let selectedQuote = '', annotationColor = 'yellow', settingTab = 'appearance', annotationUndo = null;
const file = () => files[state.active];
function toast(message, undo) {
  clearTimeout(toastTimer);
  const node = document.getElementById('toast');
  node.innerHTML = escapeHtml(message) + (undo ? ' <button class="secondary-button" data-action="undo-annotation">撤销</button>' : '');
  node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; }, undo ? 7000 : 4500);
}
function closePopover(restore = true) {
  popover.hidden = true;
  if (restore && menuTrigger?.isConnected) menuTrigger.focus();
}
function closeModal() { modal.close(); }
modal.addEventListener('close', () => {
  if (!modal.open && popover.hidden) {
    if (previousFocus?.isConnected) previousFocus.focus();
    else document.getElementById(`tab-${state.active}`)?.focus();
  }
});
function openModal(title, subtitle, content, footer = '', handlers = {}, wide = false) {
  closePopover(false);
  if (!modal.open) previousFocus = document.activeElement;
  modalHandlers = handlers;
  modal.classList.toggle('wide-dialog', wide);
  modalBody.innerHTML = `<header class="modal-header"><div><h2 id="modal-title">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="icon-button" data-close aria-label="关闭对话框">${icon('close')}</button></header><div class="modal-content">${content}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}`;
  if (!modal.open) modal.showModal();
  const focus = modal.querySelector('[autofocus]') || modal.querySelector('[data-modal-action="cancel"]') || modal.querySelector('[data-close]') || modal.querySelector('button');
  focus?.focus();
}
function modalButton(label, action, style = 'secondary-button', extra = '') { return `<button class="${style}" data-modal-action="${action}" ${extra}>${label}</button>`; }
function saveStatus() {
  const current = file(); const dirty = current?.dirty;
  document.getElementById('save-status').textContent = !current ? '就绪 · 本地文档' : state.conflict ? '未保存 · 磁盘有新版本' : dirty ? '未保存 · 草稿已暂存（演示）' : '已保存';
  document.getElementById('save-dot').classList.toggle('dirty', Boolean(dirty || state.conflict));
  document.getElementById('save-button').hidden = !current || state.mode === 'reading';
  document.getElementById('save-button').disabled = !dirty;
  document.getElementById('document-stats').textContent = current ? `${current.raw.replace(/\s/g, '').length} 字符` : '';
  document.getElementById('conflict-banner').hidden = !state.conflict;
}
function renderTabs() {
  article.setAttribute('aria-labelledby', state.active ? `tab-${state.active}` : 'tab-start');
  document.getElementById('tabs').innerHTML = (!state.active ? '<div class="tab-wrap selected" role="presentation"><button class="tab-label" role="tab" id="tab-start" aria-controls="document-article" aria-selected="true" tabindex="0" data-action="welcome">开始</button></div>' : '') + state.tabs.map(id => `<div class="tab-wrap ${id === state.active ? 'selected' : ''}" role="presentation"><button class="tab-label" role="tab" id="tab-${id}" aria-controls="document-article" aria-selected="${id === state.active}" tabindex="${id === state.active ? 0 : -1}" data-tab="${id}"><span class="file-type">${files[id].kind === 'markdown' ? 'M' : '◇'}</span><span class="file-name">${escapeHtml(files[id].name)}</span>${files[id].dirty ? '<span class="dirty-indicator" aria-label="未保存">•</span>' : ''}</button><button class="icon-button tab-close" data-close-tab="${id}" aria-label="关闭 ${escapeHtml(files[id].name)}" title="关闭">${icon('close')}</button></div>`).join('') + `<button class="icon-button tab-new" data-action="new" aria-label="新建文档" title="新建 · Ctrl N">${icon('plus')}</button>`;
  document.querySelectorAll('[data-file]').forEach(node => node.classList.toggle('selected', node.dataset.file === state.active));
}
const inline = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
function diagram() { return '<div class="sample-diagram"><span>收集资料</span><span class="flow-arrow">→</span><span>整理内容</span><span class="flow-arrow">→</span><span>导出分享</span></div>'; }
function markdown(text) {
  const lines = text.split('\n'); let output = '', index = 0, section = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const language = line.slice(3).trim(), content = []; index++;
      while (index < lines.length && !/^```/.test(lines[index])) content.push(lines[index++]); index++;
      output += language === 'mermaid' ? `${diagram()}<div class="figure-caption"><span>图 1 · 文档工作流程</span><button class="subtle-button" data-action="lightbox">查看大图 ${icon('expand')}</button><button class="icon-button" data-menu="diagram" aria-label="图表操作">${icon('more')}</button></div>` : `<pre><code>${escapeHtml(content.join('\n'))}</code></pre>`;
      continue;
    }
    if (/^##\s/.test(line)) { output += `<h2 id="section-${section++}">${inline(line.slice(3))}</h2>`; index++; continue; }
    if (/^#\s/.test(line)) { index++; continue; }
    if (/^>/.test(line)) { output += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; index++; continue; }
    if (/^- /.test(line)) {
      output += '<ul>'; while (index < lines.length && /^- /.test(lines[index])) output += `<li>${inline(lines[index++].slice(2))}</li>`; output += '</ul>'; continue;
    }
    if (/^\|/.test(line)) {
      const cells = value => value.replace(/^\||\|$/g, '').split('|').map(item => item.trim());
      const head = cells(line); index += 2; output += '<div class="doc-table-wrap"><table><thead><tr>' + head.map(item => `<th>${inline(item)}</th>`).join('') + '</tr></thead><tbody>';
      while (index < lines.length && /^\|/.test(lines[index])) output += '<tr>' + cells(lines[index++]).map(item => `<td>${inline(item)}</td>`).join('') + '</tr>';
      output += `</tbody></table></div><div class="figure-caption"><span>可复制为 Office 表格</span><button class="subtle-button" data-menu="table">表格操作 ${icon('more')}</button></div>`; continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(?:#|>|\||- |```)/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) { output += `<p>${inline(line)}</p>`; index++; }
    else output += `<p>${inline(paragraph.join(' '))}</p>`;
  }
  return output;
}
function renderReader() {
  const current = file();
  if (!current) { renderWelcome(); return; }
  article.className = 'document-article'; article.removeAttribute('style');
  const title = current.raw.match(/^# (.+)/)?.[1] || current.name;
  const heading = `<p class="doc-kicker">个人文档 / ${escapeHtml(current.folder)}</p><h1>${escapeHtml(title)}</h1><div class="doc-meta"><span>工作笔记</span><span>2026 年 11 月 5 日</span><span>本地文档</span></div>`;
  if (['markdown', 'summary'].includes(current.kind)) {
    article.innerHTML = heading + (current.kind === 'summary'
      ? '<p class="lead">选择章节开始阅读。</p><h2>目录</h2><ul><li><button class="subtle-button" data-file="guide">项目说明</button></li><li><button class="subtle-button" data-file="notes">设计笔记</button></li></ul>'
      : markdown(current.raw));
  } else if (current.kind === 'diagram' || current.kind === 'image') {
    article.innerHTML = `<p class="doc-kicker">${escapeHtml(current.name)}</p><h1>${current.kind === 'image' ? '示意图' : '文档工作流程'}</h1><p class="lead">${current.kind === 'image' ? '本地矢量图预览' : 'Mermaid · 独立图表文件'}</p><div class="lightbox-diagram">${diagram()}</div><div class="figure-caption"><span>保持原始比例</span><button class="subtle-button" data-action="lightbox">放大查看 ${icon('expand')}</button><button class="icon-button" data-menu="diagram" aria-label="图表操作">${icon('more')}</button></div>`;
  } else if (current.kind === 'slides') {
    const slides = [{ title: '本地文档工作流', sub: '从收集到分享' }, { title: '阅读与整理', sub: '让内容保持清晰。' }, { title: '输出与归档', sub: '导出当前演示文档。' }];
    const slide = slides[state.slide];
    article.innerHTML = `<p class="doc-kicker">项目演示 · ${state.slide + 1} / 3</p><div class="welcome"><h1>${slide.title}</h1><p>${slide.sub}</p></div><div class="figure-caption"><button class="secondary-button" data-action="prev-slide" ${state.slide ? '' : 'disabled'}>上一页</button><span>${state.slide + 1} / 3</span><button class="secondary-button" data-action="next-slide" ${state.slide < 2 ? '' : 'disabled'}>下一页</button></div>`;
  } else if (current.kind === 'html') {
    article.innerHTML = `${heading}<p class="lead">本地 HTML 阅读</p><p>这是一份保存在本机的参考资料。正式应用将在隔离视图中打开，不执行页面中的脚本。</p><button class="secondary-button" data-action="convert-html">转换为 Markdown</button>`;
  } else article.innerHTML = `${heading}<pre><code>${escapeHtml(current.raw)}</code></pre>`;
  article.querySelectorAll('p').forEach(node => {
    if (node.textContent.includes('把相关资料放在同一个工作区') && state.active === 'guide' && state.annotations.length) node.innerHTML = node.innerHTML.replace('把相关资料放在同一个工作区', '<mark class="annotation-highlight">把相关资料放在同一个工作区</mark>');
  });
  renderOutline();
}
function renderOutline() {
  const headings = [...article.querySelectorAll('h2')];
  document.getElementById('outline-items').innerHTML = headings.length ? headings.map((node, index) => `<button class="outline-item ${index === 0 ? 'active' : ''}" data-section="${index}"><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(node.textContent.replace(/^[一二三四五]、/, ''))}</button>`).join('') : '<p class="empty-state">这份文档还没有章节标题。</p>';
}
function renderAnnotations() {
  const items = state.active === 'guide' ? state.annotations : [];
  document.getElementById('annotation-total').textContent = `${items.length} 条批注`;
  document.querySelectorAll('.annotation-trigger .count, #annotations-tab .count').forEach(node => { node.textContent = items.length; });
  document.getElementById('annotation-list').innerHTML = items.length ? items.map(item => `<article class="annotation-card annotation-${item.color}"><button class="subtle-button annotation-quote" data-section="${item.section}">${escapeHtml(item.quote)}</button><p>${escapeHtml(item.text)}</p><div class="annotation-meta"><span>我 · 今天</span><button class="icon-button" data-delete-note="${item.id}" aria-label="删除此批注">${icon('trash')}</button></div></article>`).join('') : '<p class="empty-state">选中文字后添加批注，留下你的思考。</p>';
}
function renderRecent() {
  document.getElementById('recent-files').innerHTML = state.recent.length ? state.recent.map(id => `<button class="recent-item" data-file="${id}"><strong>${escapeHtml(files[id].name)}</strong><span>个人文档 / ${escapeHtml(files[id].folder)}</span></button>`).join('') : '<p class="empty-state">还没有最近打开的文档。</p>';
}
function renderWelcome() {
  article.className = 'welcome';
  article.innerHTML = `<span class="brand-mark welcome-mark">d.</span><h1>从一份本地文档开始</h1><p>打开文件，或把一个文件夹作为工作区。<br>你的内容始终保留在本机。</p><div class="welcome-actions"><button class="primary-button" data-action="open-file">${icon('file')}打开文件</button><button class="secondary-button" data-action="open-folder">${icon('folder')}打开文件夹</button><button class="subtle-button" data-action="new">新建笔记</button></div><section class="welcome-recent"><header><span>最近打开</span><span>本机文件</span></header>${state.recent.slice(0, 3).map(id => `<button data-file="${id}">${escapeHtml(files[id].name)}<span>个人文档 / ${escapeHtml(files[id].folder)}</span></button>`).join('') || '<p>暂无最近记录</p>'}</section>`;
  document.getElementById('outline-items').replaceChildren();
}
function updateEditor() {
  editor.value = file()?.raw || '';
  updateLineNumbers(); editor.scrollTop = file()?.sourceScroll || 0;
}
function updateLineNumbers() { document.getElementById('line-numbers').textContent = editor.value.split('\n').map((_, index) => index + 1).join('\n'); }
function setMode(mode) {
  if (!file()) return;
  if (mode === 'split' && innerWidth < 640) { mode = 'source'; toast('窄窗口已切换为源码模式，可随时返回阅读。'); }
  state.mode = mode; app.dataset.mode = mode;
  document.querySelectorAll('.mode-switch button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.mode === mode)));
  document.getElementById('editor-pane').hidden = mode === 'reading';
  document.getElementById('inspector').classList.remove('inspector-overlay');
  if (mode !== 'reading') updateEditor();
  renderReader(); saveStatus();
}
function render() {
  renderTabs(); renderReader(); renderAnnotations(); renderRecent(); updateEditor(); saveStatus();
  document.getElementById('document-toolbar').hidden = !file();
  document.getElementById('inspector').hidden = !file() || state.inspector === null;
  document.getElementById('editor-pane').hidden = !file() || state.mode === 'reading';
  document.querySelector('.workspace-picker').hidden = !state.workspace;
  document.querySelector('.tree-tools').hidden = !state.workspace;
  document.getElementById('file-tree').hidden = !state.workspace;
  document.querySelector('.sidebar-bottom').hidden = !state.workspace;
  document.querySelector('.no-workspace')?.remove();
  if (!state.workspace) document.getElementById('files-panel').insertAdjacentHTML('beforeend', '<div class="no-workspace">尚未打开工作区。<br>打开文件夹后，可以浏览目录和检索内容。<p><button class="secondary-button" data-action="open-folder">打开文件夹</button></p></div>');
  if (file()) reader.scrollTop = file().scroll;
}
function openFile(id) {
  if (!files[id]) return;
  if (file()) file().scroll = reader.scrollTop;
  state.active = id; state.conflict = Boolean(files[id].conflict); state.slide = 0;
  if (!state.tabs.includes(id)) state.tabs.push(id);
  state.recent = [id, ...state.recent.filter(item => item !== id)];
  if (!['markdown', 'summary'].includes(file().kind)) state.mode = 'reading';
  app.dataset.mode = state.mode;
  document.querySelectorAll('.mode-switch button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.mode === state.mode)));
  closePopover(false); render();
}
function saveCurrent(then) {
  if (!file()) return;
  if (state.conflict) { showConflict(); return; }
  file().disk = file().raw; file().dirty = false; renderTabs(); saveStatus();
  toast('设计演示：内容已保存，未写入本地文件。');
  if (then) then();
}
function removeTab(id) {
  state.tabs = state.tabs.filter(item => item !== id);
  if (state.active === id) state.active = state.tabs.at(-1) || null;
  state.conflict = Boolean(file()?.conflict); render(); document.getElementById(state.active ? `tab-${state.active}` : 'tab-start')?.focus();
}
function closeTab(id) {
  if (!files[id].dirty) { removeTab(id); return; }
  openModal('保存对文档的修改？', `${files[id].name} 有未保存的修改。`, '<p class="compare-help">保存后关闭，或取消并继续编辑。放弃修改只影响当前编辑稿，不删除源文件。</p>',
    modalButton('不保存', 'discard', 'subtle-button danger-button') + modalButton('取消', 'cancel') + modalButton('保存并关闭', 'save', 'primary-button'), {
      cancel: closeModal,
      discard: () => { files[id].raw = files[id].disk; files[id].dirty = false; files[id].conflict = false; closeModal(); removeTab(id); },
      save: () => { if (files[id].conflict) { openFile(id); showConflict(); } else { files[id].disk = files[id].raw; files[id].dirty = false; closeModal(); removeTab(id); toast('设计演示：已保存并关闭，未写入本地文件。'); } },
    });
}
function setNav(nav) {
  state.nav = nav;
  document.querySelectorAll('[data-nav]').forEach(node => { node.classList.toggle('active', node.dataset.nav === nav); node.setAttribute('aria-pressed', String(node.dataset.nav === nav)); });
  for (const name of ['files', 'search', 'recent']) document.getElementById(`${name}-panel`).hidden = name !== nav;
  document.getElementById('sidebar-title').textContent = { files: '工作区', search: '检索', recent: '最近打开' }[nav];
  app.classList.remove('sidebar-hidden'); if (innerWidth < 900) app.classList.add('sidebar-drawer');
  if (nav === 'search') document.getElementById('search-input').focus();
  renderRecent();
}
function setInspector(name) {
  state.inspector = name; document.getElementById('inspector').hidden = !name || !file();
  if (!name) return;
  for (const tab of ['outline', 'annotations']) {
    const active = name === tab;
    document.getElementById(`${tab}-tab`).setAttribute('aria-selected', String(active));
    document.getElementById(`${tab}-tab`).tabIndex = active ? 0 : -1;
    document.getElementById(`${tab}-panel`).hidden = !active;
  }
  document.getElementById('inspector').classList.toggle('inspector-overlay', innerWidth < 1280 || state.mode !== 'reading');
  renderAnnotations();
}
function goSection(index) {
  const target = article.querySelectorAll('h2')[index]; if (!target) return;
  reader.scrollTo({ top: reader.scrollTop + target.getBoundingClientRect().top - reader.getBoundingClientRect().top - 24, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  document.querySelectorAll('.outline-item').forEach((node, i) => node.classList.toggle('active', i === index));
}
function search() {
  clearTimeout(searchTimer); const generation = ++searchGeneration;
  const query = document.getElementById('search-input').value.trim(); if (!query) return;
  document.getElementById('search-status').textContent = '正在扫描 · 已检查 2 / 8 个文件';
  document.getElementById('search-cancel').hidden = false; document.getElementById('search-start').disabled = true;
  document.getElementById('search-results').replaceChildren();
  searchTimer = setTimeout(() => {
    if (generation !== searchGeneration) return;
    const filename = document.getElementById('search-mode').value === 'filename'; let total = 0; const groups = [];
    for (const [id, item] of Object.entries(files)) {
      const hits = filename ? (item.name.toLowerCase().includes(query.toLowerCase()) ? [{ line: 1, text: item.name }] : [])
        : item.raw.split('\n').map((text, index) => ({ text, line: index + 1 })).filter(hit => hit.text.toLowerCase().includes(query.toLowerCase()));
      if (!hits.length) continue;
      total += hits.length;
      groups.push(`<section class="result-group"><div class="result-name">${escapeHtml(item.name)}</div>${hits.slice(0, 3).map(hit => {
        const position = hit.text.toLowerCase().indexOf(query.toLowerCase());
        const snippet = filename ? escapeHtml(hit.text) : escapeHtml(hit.text.slice(0, position)) + `<mark>${escapeHtml(hit.text.slice(position, position + query.length))}</mark>` + escapeHtml(hit.text.slice(position + query.length));
        return `<button class="search-result" data-search-file="${id}" data-line="${hit.line}"><span>${hit.line}</span><span>${snippet}</span></button>`;
      }).join('')}</section>`);
    }
    document.getElementById('search-status').textContent = `${total} 处匹配 · 已检查 ${Object.keys(files).length} 个演示文件`;
    document.getElementById('search-results').innerHTML = groups.join('') || '<p class="empty-state">没有找到匹配内容。试试更短的关键字，或切换检索范围。</p>';
    document.getElementById('search-cancel').hidden = true; document.getElementById('search-start').disabled = false;
  }, 700);
}
function cancelSearch(message = '已取消检索，已有文档不受影响。') {
  clearTimeout(searchTimer); searchGeneration++;
  document.getElementById('search-cancel').hidden = true; document.getElementById('search-start').disabled = false;
  document.getElementById('search-results').replaceChildren(); document.getElementById('search-status').textContent = message;
}
const menuItem = (label, action, name, key = '', disabled = false) => `<button class="menu-item" role="menuitem" data-action="${action}" ${disabled ? 'disabled' : ''}>${icon(name)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
function showMenu(name, trigger) {
  const menu = {
    file: menuItem('新建笔记', 'new', 'file-plus', 'Ctrl N') + menuItem('打开文件…', 'open-file', 'file', 'Ctrl O') + menuItem('打开文件夹…', 'open-folder', 'folder') + '<div class="menu-rule"></div>' + menuItem('保存', 'save', 'save', 'Ctrl S', !file()) + menuItem('另存为…', 'save-copy', 'copy', 'Ctrl Shift S', !file()) + '<div class="menu-rule"></div>' + menuItem('本地 HTML 转 Markdown', 'convert-html', 'file') + menuItem('设置', 'settings', 'settings', 'Ctrl ,'),
    view: menuItem('文件侧栏', 'toggle-sidebar', 'panel-left', 'Ctrl B') + menuItem('文档目录', 'outline', 'list') + menuItem('文档批注', 'annotations', 'comment') + menuItem('专注阅读', 'focus', 'expand') + '<div class="menu-rule"></div>' + menuItem('文档外观', 'document-style', 'type') + menuItem('应用外观', 'appearance', 'sun'),
    help: menuItem('快捷键', 'shortcuts', 'keyboard') + menuItem('关于 docu.md', 'about', 'file'),
    workspace: menuItem('打开其他文件夹…', 'open-folder', 'folder-plus') + menuItem('定位当前文件', 'locate', 'locate') + menuItem('刷新目录', 'refresh-tree', 'folder') + '<div class="menu-rule"></div>' + menuItem('关闭此工作区', 'close-workspace', 'close'),
    document: menuItem('文档目录', 'outline', 'list') + menuItem('批注', 'annotations', 'comment') + menuItem('文档外观', 'document-style', 'type') + menuItem('重新载入磁盘', 'reload', 'clock') + menuItem('查找与替换', 'find', 'search', 'Ctrl H') + '<div class="menu-rule"></div>' + menuItem('导出当前文档资产', 'assets', 'download') + menuItem('另存为…', 'save-copy', 'copy'),
    table: menuItem('复制表格（Office 格式）', 'copy-table', 'copy') + menuItem('复制 TSV', 'copy-tsv', 'copy') + menuItem('导出 Excel 工作簿…', 'export-xlsx', 'download'),
    diagram: menuItem('放大查看', 'lightbox', 'expand') + menuItem('复制 PNG', 'copy-image', 'copy') + menuItem('保存 PNG…', 'export-image', 'download') + menuItem('保存 SVG…', 'export-svg', 'download') + menuItem('保存 DrawIO 源文件…', 'unavailable-drawio', 'file', '', true) + '<div class="menu-heading">此 Mermaid 示例没有 DrawIO 源文件</div>',
    annotations: menuItem('导入批注…', 'import-annotations', 'file') + menuItem('导出批注…', 'export-annotations', 'download') + menuItem('复制结构化批注', 'copy-annotations', 'copy') + menuItem('批注显示设置', 'annotation-settings', 'settings'),
  }[name];
  if (!menu) return;
  menuTrigger = trigger; popover.innerHTML = menu; popover.setAttribute('role', 'menu'); popover.hidden = false;
  const rect = trigger.getBoundingClientRect();
  popover.style.left = `${Math.min(Math.max(10, rect.left), innerWidth - popover.offsetWidth - 10)}px`;
  popover.style.top = `${Math.min(rect.bottom + 6, innerHeight - popover.offsetHeight - 10)}px`;
  popover.querySelector('button:not(:disabled)')?.focus();
}
function showExport() {
  if (!file()) return;
  const types = [['pdf', 'PDF', '固定版式，适合归档'], ['docx', 'Word', '后续编辑与协作'], ['html', 'HTML', '离线单文件分享'], ['png', '长图', '保存当前文档 PNG']];
  openModal('导出当前文档', `${file().name}${file().dirty ? ' · 包含未保存的编辑稿' : ''}`, `<div class="format-grid">${types.map(([id, title, text]) => `<button class="format-option" data-format="${id}" aria-pressed="${state.format === id}"><strong>${title}</strong><span>${text}</span></button>`).join('')}</div><div class="form-row"><label for="export-name">文件名</label><input id="export-name" value="${escapeHtml(file().name.replace(/\.[^.]+$/, ''))}" maxlength="120"></div><div id="export-options"></div><div class="export-note">使用当前文档与外观的快照。导出期间可以继续阅读或编辑；保存位置将在系统对话框中选择。</div>`,
    '<span class="footer-note">仅导出当前文档</span>' + modalButton('取消', 'cancel') + modalButton('选择位置并导出', 'export', 'primary-button'), { cancel: closeModal, export: startExport });
  exportOptions();
}
function exportOptions() {
  const descriptions = {
    pdf: '<div class="form-row"><label for="paper-size">纸张</label><select id="paper-size"><option>A4 · 纵向</option><option>A4 · 横向</option><option>Letter · 纵向</option></select></div><div class="form-row"><label for="page-margin">页边距</label><select id="page-margin"><option>标准 · 20 mm</option><option>紧凑 · 12 mm</option><option>宽松 · 25 mm</option></select></div>',
    docx: '<div class="form-row"><span>公式</span><label class="check-label"><input type="checkbox" checked>保留为可编辑公式</label></div><div class="form-row"><span>批注标记</span><label class="check-label"><input type="checkbox">包含文内高亮标记</label></div>',
    html: '<div class="form-row"><span>资源</span><label class="check-label"><input type="checkbox" checked disabled>嵌入样式、图像和所需字体</label></div><div class="form-row"><span>导出结果</span><span>一个可离线打开的 HTML 文件</span></div>',
    png: '<div class="form-row"><label for="image-scale">清晰度</label><select id="image-scale"><option>2 倍 · 推荐</option><option>1 倍 · 标准</option><option>3 倍 · 高清</option></select></div><div class="form-row"><span>范围</span><span>当前文档全文，不包含应用界面</span></div>',
  };
  document.getElementById('export-options').innerHTML = descriptions[state.format];
}
function startExport() {
  const name = document.getElementById('export-name').value.trim();
  if (!name) { document.getElementById('export-name').focus(); return; }
  const task = { id: Date.now(), name: `${name}.${state.format}`, source: file().name, snapshot: file().raw, progress: 0, state: 'running' };
  state.tasks.push(task); closeModal();
  const node = document.getElementById('task-status'); node.hidden = false; node.textContent = '正在导出 · 0%';
  task.timer = setInterval(() => {
    task.progress = Math.min(100, task.progress + 20);
    if (task.progress === 100) { clearInterval(task.timer); task.state = 'complete'; toast(`设计演示：${task.name} 导出完成，未生成实际文件。`); }
    node.textContent = task.state === 'complete' ? '导出完成 · 1 项' : `正在导出 · ${task.progress}%`;
    if (modal.open && modalBody.querySelector('[data-tasks]')) renderTaskRows();
  }, 450);
}
function taskRows() {
  return state.tasks.length ? state.tasks.map(task => `<section class="task-row"><div><strong>${escapeHtml(task.name)}</strong><span>${{ running: '正在准备文档', complete: '演示完成', canceled: '已取消' }[task.state]}</span></div><progress max="100" value="${task.progress}" aria-label="导出进度"></progress><p>来源：${escapeHtml(task.source)} · 任务开始时的内容快照</p><div class="task-actions">${task.state === 'running' ? `<button class="secondary-button" data-cancel-task="${task.id}">取消导出</button>` : task.state === 'complete' ? '<span class="side-caption">本样稿不生成或写入文件</span>' : '<span class="side-caption">没有生成产物，可以重新导出</span>'}</div></section>`).join('') : '<p class="empty-state">暂无导出任务。导出后可以在这里查看进度和取消任务。</p>';
}
function showTasks() { openModal('导出任务', '任务与文档阅读相互独立。', `<div data-tasks>${taskRows()}</div>`, modalButton('关闭', 'cancel'), { cancel: closeModal }); }
function renderTaskRows() { const node = modalBody.querySelector('[data-tasks]'); if (node) node.innerHTML = taskRows(); }
function showConflict() {
  if (!file()) return;
  openModal('处理外部修改', file().name, `<div class="compare-columns"><section><h3>我的编辑稿 · 未保存</h3><pre>${escapeHtml(file().raw)}</pre></section><section><h3>磁盘版本 · 外部已修改</h3><pre>${escapeHtml(file().externalRaw || file().disk)}</pre></section></div><p class="compare-help">关闭此窗口会继续保留编辑稿。另存副本可以同时保留两个版本；重新载入磁盘会放弃当前编辑稿。</p>`,
    modalButton('重新载入磁盘…', 'reload', 'subtle-button danger-button') + modalButton('保留编辑', 'cancel') + modalButton('另存副本', 'copy', 'primary-button'), { cancel: closeModal, reload: confirmReload, copy: saveCopy }, true);
}
function saveCopy() {
  if (!file()) return;
  openModal('另存副本', '保留原文件，将当前编辑稿存为另一份文档。', `<div class="form-row"><label for="copy-name">新文件名</label><input id="copy-name" autofocus value="${escapeHtml(file().name.replace(/\.[^.]+$/, ''))}-副本.md"></div><p class="compare-help">正式应用通过系统保存对话框选择位置；此处仅演示名称与保存后的状态。</p>`, modalButton('取消', 'cancel') + modalButton('保存副本', 'save', 'primary-button'), { cancel: closeModal, save: () => {
    const name = document.getElementById('copy-name').value.trim(); if (!name) return;
    const old = state.active, id = `copy-${Date.now()}`;
    files[id] = { ...file(), name, disk: file().raw, dirty: false, conflict: false };
    state.tabs = state.tabs.map(item => item === old ? id : item); state.active = id; state.conflict = false;
    // Original external version remains available through its original file entry.
    files[old].raw = files[old].externalRaw || files[old].disk; files[old].disk = files[old].raw; files[old].dirty = false; files[old].conflict = false;
    state.recent.unshift(id); closeModal(); render(); toast('设计演示：已另存副本，原文件保留。未写入本地文件。');
  } });
}
function confirmReload() {
  if (!file()) return;
  if (!file().dirty) { reloadCurrent(); return; }
  openModal('放弃当前编辑稿？', '重新载入后显示磁盘上的最新内容。', '<p class="compare-help">尚未保存的修改会被放弃。需要保留时，请取消并使用“另存副本”。</p>', modalButton('取消', 'cancel') + modalButton('放弃编辑并重新载入', 'reload', 'secondary-button danger-button'), { cancel: closeModal, reload: reloadCurrent });
}
function reloadCurrent() { file().raw = file().externalRaw || file().disk; file().disk = file().raw; file().dirty = false; file().conflict = false; state.conflict = false; if (modal.open) closeModal(); render(); toast('设计演示：已重新载入磁盘版本。'); }
function showQuickOpen() {
  openModal('快速打开', '', '<label><span class="sr-only">文件或命令</span><input id="quick-input" class="quick-search-input" placeholder="搜索文件，或输入 > 查找命令" autofocus></label><div id="quick-results" class="quick-list"></div>');
  renderQuick('');
}
function renderQuick(query) {
  const commands = [['新建笔记', 'new', 'Ctrl N'], ['打开文件', 'open-file', 'Ctrl O'], ['设置', 'settings', 'Ctrl ,'], ['导出当前文档', 'export', ''], ['切换专注阅读', 'focus', 'Ctrl Shift Enter']];
  const command = query.startsWith('>');
  document.getElementById('quick-results').innerHTML = command ? commands.filter(item => item[0].includes(query.slice(1).trim())).map(([name, action, key]) => `<button class="quick-item" data-action="${action}">${icon('arrow')}<div>${name}<small>命令</small></div>${key ? `<kbd>${key}</kbd>` : ''}</button>`).join('') : Object.entries(files).filter(([, item]) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8).map(([id, item]) => `<button class="quick-item" data-quick-file="${id}">${icon('file')}<div>${escapeHtml(item.name)}<small>个人文档 / ${escapeHtml(item.folder)}</small></div></button>`).join('') || '<p class="empty-state">没有匹配文件。输入 &gt; 可查找命令。</p>';
}
function setTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  app.dataset.theme = document.body.classList.contains('dark') ? 'dark' : 'light';
  const node = document.querySelector('[data-action="appearance"] [data-icon]'); if (node) node.innerHTML = icon(document.body.classList.contains('dark') ? 'moon' : 'sun');
}
function showSettings(tab = 'appearance') {
  settingTab = tab;
  const items = [['general', '常规'], ['appearance', '外观'], ['reading', '阅读与编辑'], ['files', '文件'], ['export', '导出'], ['data', '数据与缓存'], ['shortcuts', '快捷键'], ['about', '关于']];
  openModal('设置', '应用偏好与文档外观分别管理。', `<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${items.map(([id, title]) => `<button data-setting-tab="${id}" class="${id === tab ? 'active' : ''}">${title}</button>`).join('')}</nav><section id="settings-body" class="settings-body"></section></div>`, '<span class="footer-note">此样稿只在当前页面演示设置</span>' + modalButton('完成', 'cancel', 'primary-button'), { cancel: closeModal }, true);
  renderSettings();
}
function setting(label, control, description = '') { return `<div class="setting-block"><div><span>${label}</span>${control}</div>${description ? `<p>${description}</p>` : ''}</div>`; }
function renderSettings() {
  const title = { general: '常规', appearance: '外观', reading: '阅读与编辑', files: '文件', export: '导出', data: '数据与缓存', shortcuts: '快捷键', about: '关于 docu.md' }[settingTab];
  const theme = document.body.classList.contains('dark') ? 'dark' : 'light';
  const pages = {
    general: setting('启动时', '<select aria-label="启动时"><option>恢复上次工作区和文档</option><option>显示开始页</option></select>') + setting('语言', '<select aria-label="语言"><option>简体中文</option><option>跟随系统</option><option>English</option></select>', '正式应用保留全部已登记语言，翻译应覆盖菜单、错误与对话框。'),
    appearance: setting('应用外观', `<select id="theme-select" aria-label="应用外观"><option value="light" ${theme === 'light' ? 'selected' : ''}>浅色</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>深色</option><option value="system">跟随系统</option></select>`, '改变文件侧栏、菜单和编辑界面；文档主题可以单独设置。') + setting('界面密度', '<select aria-label="界面密度"><option>标准 · 推荐</option><option>紧凑</option></select>', '密度方案纳入后续视觉评审；本样稿先采用标准密度。') + setting('文档主题', '<button class="secondary-button" data-action="document-style">调整文档外观</button>', '阅读和导出默认使用同一文档主题，导出前可以确认。'),
    reading: setting('正文宽度', '<select aria-label="正文宽度"><option>舒适 · 736 px</option><option>紧凑 · 640 px</option><option>宽屏 · 960 px</option></select>') + setting('编辑预览', '<label><input type="checkbox" checked aria-label="自动更新分栏预览"> 自动更新</label>', '内容修改后合并更新；复杂图表后台渲染，不打断输入。') + setting('批注显示', '<select aria-label="批注样式"><option>背景高亮</option><option>下划线</option><option>波浪线</option><option>边框</option></select>'),
    files: setting('外部修改', '<label><input id="refresh-setting" type="checkbox" checked> 自动刷新</label>', '有未保存编辑时保留编辑稿，不自动载入磁盘内容。') + setting('编码', '<select aria-label="默认编码"><option>UTF-8 · 自动保留 BOM</option></select>', '无法识别的编码在正式应用中提供“以指定编码重新打开”。') + setting('本地资源目录', '<button class="secondary-button" data-action="resource-folder">添加文件夹…</button>', '仅授权明确选择的本机目录，可随时移除。'),
    export: setting('默认格式', '<select aria-label="默认导出格式"><option>PDF</option><option>Word</option><option>HTML</option><option>PNG</option></select>') + setting('纸张', '<select aria-label="默认纸张"><option>A4 · 纵向</option><option>Letter · 纵向</option></select>') + setting('资源缺失', '<span>显示问题并要求处理</span>', '不把缺少关键图片或图表的文档直接标记为导出成功。'),
    data: setting('草稿与阅读记录', '<button class="secondary-button" data-action="backup-data">备份…</button>', '正式版本应支持本地备份、草稿恢复和明确的恢复提示。') + setting('渲染缓存', '<span>24.8 MB</span>', '演示数据。缓存可重新生成，清理不影响源文件、批注和草稿。') + setting('缓存管理', '<button class="secondary-button" data-action="clear-cache">清理缓存</button>') + setting('最近记录', '<button class="secondary-button" data-action="clear-recent">清空记录</button>'),
    shortcuts: shortcutTable(),
    about: '<p><strong>docu.md Desktop</strong></p><p>面向本地文档的个人桌面应用。</p><p>当前展示：正式产品界面设计 R0.1。此版本是交互样稿，不是可用的正式桌面应用。</p><p>应用设计为离线使用，无账号、云同步或在线内容入口。</p><button class="secondary-button" data-action="licenses">许可证与第三方组件</button>',
  };
  document.getElementById('settings-body').innerHTML = `<h3>${title}</h3>${pages[settingTab]}`;
  document.querySelectorAll('[data-setting-tab]').forEach(node => node.classList.toggle('active', node.dataset.settingTab === settingTab));
}
function shortcutTable() {
  return '<table class="shortcuts-table"><tbody>' + [['快速打开 / 命令', 'Ctrl K'], ['打开文件', 'Ctrl O'], ['新建笔记', 'Ctrl N'], ['保存 / 另存', 'Ctrl S / Ctrl Shift S'], ['关闭文档', 'Ctrl W'], ['全文检索', 'Ctrl Shift F'], ['文内查找 / 替换', 'Ctrl F / Ctrl H'], ['切换文件侧栏', 'Ctrl B'], ['设置', 'Ctrl ,'], ['专注阅读', 'Ctrl Shift Enter'], ['关闭浮层 / 退出专注', 'Esc']].map(([name, key]) => `<tr><td>${name}</td><td><kbd>${key}</kbd></td></tr>`).join('') + '</tbody></table>';
}
function showDocumentStyle(trigger) {
  if (modal.open) closeModal();
  menuTrigger = trigger; popover.removeAttribute('role');
  popover.innerHTML = `<section class="popover-section"><label for="paper-theme">文档主题</label><select id="paper-theme"><option value="default">简洁 · 跟随应用</option><option value="warm">暖纸 · 长文阅读</option><option value="technical">技术 · 清晰等宽代码</option></select><label>字号</label><div class="range-control"><button data-font-size="-1" aria-label="减小字号">−</button><span id="font-size-value">${getComputedStyle(document.documentElement).getPropertyValue('--doc-size').trim()}</span><button data-font-size="1" aria-label="增大字号">+</button></div><label for="paper-width">阅读宽度</label><select id="paper-width"><option value="736">舒适 · 736 px</option><option value="640">紧凑 · 640 px</option><option value="960">宽屏 · 960 px</option></select><p class="side-caption">文档外观也将用于导出预览。</p></section>`;
  popover.hidden = false;
  const rect = trigger?.getBoundingClientRect() || { right: innerWidth - 20, bottom: 100 };
  popover.style.left = `${Math.max(10, Math.min(innerWidth - popover.offsetWidth - 10, rect.right - popover.offsetWidth))}px`;
  popover.style.top = `${Math.min(rect.bottom + 6, innerHeight - popover.offsetHeight - 10)}px`;
  popover.querySelector('select').focus();
}
function newDocument() {
  const id = `new-${Date.now()}`; files[id] = { name: '未命名.md', kind: 'markdown', folder: '未保存草稿', raw: '# 未命名\n\n', disk: '', dirty: true, scroll: 0 };
  if (modal.open) closeModal(); openFile(id); setMode(innerWidth < 640 ? 'source' : 'split'); editor.focus();
}
function openPicker(folder = false) {
  openModal(folder ? '打开本地文件夹' : '打开本地文件', '正式应用使用系统选择器。这里选择演示内容来评审打开后的状态。', `<div class="quick-list">${(folder ? [['workspace', { name: '个人文档', folder: '包含 Markdown、图表与参考资料' }]] : Object.entries(files).slice(0, 8)).map(([id, item]) => `<button class="quick-item" ${folder ? 'data-open-workspace' : `data-quick-file="${id}"`}>${icon(folder ? 'folder' : 'file')}<div>${escapeHtml(item.name)}<small>${escapeHtml(item.folder)}</small></div>${icon('arrow')}</button>`).join('')}</div>`, modalButton('取消', 'cancel'), { cancel: closeModal });
}
function addAnnotation() {
  const selection = getSelection();
  if (selection && article.contains(selection.anchorNode) && selection.toString().trim()) selectedQuote = selection.toString().trim().slice(0, 200);
  if (!selectedQuote) selectedQuote = '把相关资料放在同一个工作区';
  openModal('添加批注', file()?.name || '当前文档', `<div class="annotation-form"><blockquote>${escapeHtml(selectedQuote)}</blockquote><label class="sr-only" for="annotation-text">批注内容</label><textarea id="annotation-text" autofocus placeholder="写下你的想法…"></textarea><div class="annotation-colors"><span>标记颜色</span>${['yellow', 'blue', 'green', 'pink'].map((color, index) => `<button class="${color}-color" data-annotation-color="${color}" aria-label="${['黄色', '蓝色', '绿色', '粉色'][index]}" aria-pressed="${color === annotationColor}"></button>`).join('')}</div></div>`, modalButton('取消', 'cancel') + modalButton('保存批注', 'save', 'primary-button'), { cancel: closeModal, save: () => {
    const text = document.getElementById('annotation-text').value.trim(); if (!text) { document.getElementById('annotation-text').focus(); return; }
    state.annotations.unshift({ id: `a${Date.now()}`, quote: selectedQuote, text, section: 0, color: annotationColor }); closeModal();
    if (state.active !== 'guide') openFile('guide'); setInspector('annotations'); renderReader(); renderAnnotations(); toast('设计演示：批注已添加，仅保留在当前样稿中。');
  } });
}
function focusMode() { app.classList.toggle('focus-mode'); toast(app.classList.contains('focus-mode') ? '专注阅读 · 按 Esc 返回工作台' : '已返回工作台'); }
function startConflictScene() {
  openFile('guide'); files.guide.raw = guide.replace('一份面向日常工作的本地文档。', '我正在补充这份项目说明，还没有保存。'); files.guide.dirty = true;
  files.guide.externalRaw = guide.replace('一份面向日常工作的本地文档。', '另一个编辑器刚刚更新了项目说明。'); files.guide.conflict = true;
  state.conflict = true; setMode('split'); render();
}
function selectScene(scene) {
  if (modal.open) closeModal(); closePopover(false); app.classList.remove('focus-mode', 'sidebar-drawer', 'sidebar-hidden');
  Object.keys(initialFiles).forEach(id => { Object.assign(files[id], initialFiles[id], { disk: initialFiles[id].raw, dirty: false, conflict: false, scroll: 0 }); });
  state.tabs = ['guide', 'notes']; state.active = 'guide'; state.mode = 'reading'; state.workspace = true; state.conflict = false; state.inspector = 'outline';
  app.dataset.mode = 'reading'; setNav('files'); setInspector('outline');
  if (innerWidth < 900) app.classList.remove('sidebar-drawer');
  document.querySelectorAll('.mode-switch button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.mode === state.mode)));
  if (scene === 'empty') { state.tabs = []; state.active = null; state.workspace = false; render(); return; }
  if (scene === 'conflict') { startConflictScene(); return; }
  render();
  if (scene === 'editing') setMode('split');
  if (scene === 'search') { setNav('search'); document.getElementById('search-input').value = '导出'; search(); }
  if (scene === 'annotations') setInspector('annotations');
}
function showStart() {
  if (file()) file().scroll = reader.scrollTop;
  state.active = null; state.mode = 'reading'; state.conflict = false; app.dataset.mode = 'reading'; render();
}
function closeWorkspace() {
  const dirty = state.tabs.filter(id => files[id].dirty);
  const leave = () => {
    closeModal(); state.tabs = []; state.active = null; state.workspace = false; state.conflict = false;
    state.mode = 'reading'; app.dataset.mode = 'reading'; render();
  };
  if (!dirty.length) {
    openModal('关闭此工作区？', '文档文件不会被删除。', '<p class="compare-help">关闭关联标签并返回开始页；阅读位置和批注继续保留。</p>', modalButton('取消', 'cancel') + modalButton('关闭工作区', 'close'), { cancel: closeModal, close: leave });
    return;
  }
  openModal('工作区中有未保存的修改', `${dirty.length} 个文档需要处理。`, `<p class="compare-help">${dirty.map(id => escapeHtml(files[id].name)).join('、')}<br>可以取消并逐个处理，也可以全部保存后关闭。</p>`,
    modalButton('不保存并关闭', 'discard', 'subtle-button danger-button') + modalButton('取消', 'cancel') + modalButton('全部保存并关闭', 'save', 'primary-button'), {
      cancel: closeModal,
      discard: () => { dirty.forEach(id => { files[id].raw = files[id].disk; files[id].dirty = false; }); leave(); },
      save: () => {
        const conflict = dirty.find(id => files[id].conflict);
        if (conflict) { closeModal(); openFile(conflict); showConflict(); return; }
        dirty.forEach(id => { files[id].disk = files[id].raw; files[id].dirty = false; }); leave(); toast('设计演示：已保存并关闭工作区，未写入本地文件。');
      },
    });
}
const actions = {
  welcome: showStart, 'quick-open': showQuickOpen, settings: () => showSettings(), appearance: () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark'),
  new: newDocument, 'open-file': () => openPicker(), 'open-folder': () => openPicker(true),
  'toggle-sidebar': () => { if (innerWidth < 900) app.classList.toggle('sidebar-drawer'); else app.classList.toggle('sidebar-hidden'); },
  save: () => saveCurrent(), 'save-copy': saveCopy, reload: confirmReload, compare: showConflict,
  focus: focusMode, outline: () => setInspector(state.inspector === 'outline' && !document.getElementById('inspector').hidden && getComputedStyle(document.getElementById('inspector')).display !== 'none' ? null : 'outline'), annotations: () => setInspector('annotations'), 'close-inspector': () => setInspector(null),
  export: showExport, tasks: showTasks, 'document-style': trigger => showDocumentStyle(trigger),
  shortcuts: () => openModal('键盘快捷键', '常用操作始终同时提供可见入口。', shortcutTable(), modalButton('关闭', 'cancel'), { cancel: closeModal }),
  about: () => showSettings('about'),
  locate: () => { setNav('files'); const row = document.querySelector(`.file-row[data-file="${state.active}"]`); if (row) { const details = row.closest('details'); if (details) details.open = true; row.focus(); } else toast('当前文档不在已打开的工作区中。'); },
  'refresh-tree': () => toast('设计演示：工作区目录已刷新。'),
  'close-workspace': closeWorkspace,
  'clear-recent': () => openModal('清空最近记录？', '不会关闭当前文档，也不会删除文件、批注或草稿。', '', modalButton('取消', 'cancel') + modalButton('清空记录', 'clear', 'primary-button'), { cancel: closeModal, clear: () => { state.recent = []; renderRecent(); closeModal(); toast('设计演示：最近记录已清空。'); } }),
  'refresh-toggle': () => { state.refresh = !state.refresh; const node = document.getElementById('auto-refresh'); node.textContent = state.refresh ? '自动刷新' : '自动刷新已暂停'; node.setAttribute('aria-pressed', String(state.refresh)); toast(state.refresh ? '自动刷新已恢复；有未保存修改时仍保留编辑稿。' : '自动刷新已暂停，文档保持当前内容。'); },
  find: () => { if (!file()) return; if (state.mode === 'reading') setMode('split'); document.getElementById('editor-find').hidden = false; document.getElementById('find-text').focus(); },
  'close-find': () => { document.getElementById('editor-find').hidden = true; editor.focus(); },
  replace: () => { const find = document.getElementById('find-text').value, replacement = document.getElementById('replace-text').value; if (!find) return; const position = editor.value.indexOf(find, editor.selectionEnd); const index = position >= 0 ? position : editor.value.indexOf(find); if (index < 0) { toast('没有匹配文本。'); return; } editor.setRangeText(replacement, index, index + find.length, 'select'); editor.dispatchEvent(new Event('input', { bubbles: true })); },
  lightbox: () => openModal('文档工作流程', '图表查看 · 不改变正文布局', `<div class="lightbox-diagram">${diagram()}</div><p class="lightbox-caption">正式应用支持平移、滚轮缩放与原始比例；Esc 关闭。</p>`, modalButton('关闭', 'cancel') + '<button class="secondary-button" data-action="export-svg">保存 SVG…</button>', { cancel: closeModal }, true),
  'add-annotation': addAnnotation,
  'undo-annotation': () => { if (annotationUndo) { state.annotations.splice(annotationUndo.index, 0, annotationUndo.item); annotationUndo = null; renderAnnotations(); renderReader(); document.getElementById('toast').hidden = true; } },
  'annotation-settings': () => showSettings('reading'),
  'convert-html': () => openModal('本地 HTML 转 Markdown', '选择本机 HTML 文件，或粘贴 HTML 内容。', '<div class="annotation-form"><label for="html-input">HTML 内容</label><textarea id="html-input" placeholder="粘贴 HTML…">&lt;h1&gt;参考资料&lt;/h1&gt;\n&lt;p&gt;整理为本地 Markdown 笔记。&lt;/p&gt;</textarea></div><p class="compare-help">不读取网址，不下载远程资源。转换后先预览，再保存。</p>', modalButton('取消', 'cancel') + modalButton('预览转换结果', 'convert', 'primary-button'), { cancel: closeModal, convert: () => { newDocument(); file().raw = '# 参考资料\n\n整理为本地 Markdown 笔记。\n'; render(); setMode('split'); toast('设计演示：已展示转换结果，正式实现需使用共享转换引擎。'); } }),
  assets: () => openModal('当前文档资产', file()?.name || '当前文档', '<p class="compare-help">图 1 · 文档工作流程　Mermaid　可导出 PNG / SVG</p><div class="form-row"><span>导出范围</span><select aria-label="资产导出范围"><option>全部图片与图表</option><option>仅图表</option><option>按序号选择</option></select></div><p class="compare-help">有错误的条目会单独列出，不会静默遗漏。</p>', modalButton('取消', 'cancel') + modalButton('选择文件夹并导出', 'export', 'primary-button'), { cancel: closeModal, export: () => { closeModal(); toast('设计演示：已选择资产导出，未生成文件。'); } }),
};
for (const [action, message] of Object.entries({ 'copy-table': '表格将以 HTML + TSV 复制，便于粘贴至 Office。', 'copy-tsv': '表格将以 TSV 文本复制。', 'export-xlsx': '将通过系统对话框保存 Excel 工作簿。', 'copy-image': '图像将以 PNG 复制。', 'export-image': '将通过系统对话框保存 PNG。', 'export-svg': '此图表可保存原生 SVG。', 'import-annotations': '正式应用将选择本地批注文件，预览合并后导入。', 'export-annotations': '正式应用将导出当前文档的批注文件。', 'copy-annotations': '正式应用将复制结构化批注。', 'resource-folder': '正式应用将选择并授权额外的本机资源目录。', 'backup-data': '正式应用将备份设置、阅读记录、批注和草稿。', licenses: '正式应用将在本地展示许可证和第三方组件说明。' })) actions[action] = () => toast(`设计演示：${message} 当前不读写文件或剪贴板。`);
actions['clear-cache'] = () => toast('设计演示：可清理缓存；源文档、批注和草稿保持不变。');
actions['prev-slide'] = () => { state.slide = Math.max(0, state.slide - 1); renderReader(); };
actions['next-slide'] = () => { state.slide = Math.min(2, state.slide + 1); renderReader(); };

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.disabled) return;
  if (button?.hasAttribute('data-close')) { closeModal(); return; }
  if (button?.dataset.modalAction) { modalHandlers[button.dataset.modalAction]?.(); return; }
  if (button?.dataset.settingTab) { settingTab = button.dataset.settingTab; renderSettings(); return; }
  if (button?.dataset.format) { state.format = button.dataset.format; modal.querySelectorAll('[data-format]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.format === state.format))); exportOptions(); return; }
  if (button?.dataset.annotationColor) { annotationColor = button.dataset.annotationColor; modal.querySelectorAll('[data-annotation-color]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.annotationColor === annotationColor))); return; }
  if (button?.dataset.fontSize) { const value = Math.max(14, Math.min(22, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--doc-size')) + Number(button.dataset.fontSize))); document.documentElement.style.setProperty('--doc-size', `${value}px`); document.getElementById('font-size-value').textContent = `${value}px`; document.getElementById('zoom-value').textContent = `${Math.round(value / 16 * 100)}%`; return; }
  if (button?.dataset.cancelTask) { const task = state.tasks.find(item => String(item.id) === button.dataset.cancelTask); if (task) { clearInterval(task.timer); task.state = 'canceled'; document.getElementById('task-status').textContent = '导出已取消'; renderTaskRows(); toast('设计演示：导出已取消，没有生成产物。'); } return; }
  if (button?.dataset.deleteNote) { const index = state.annotations.findIndex(item => item.id === button.dataset.deleteNote); annotationUndo = { item: state.annotations[index], index }; state.annotations.splice(index, 1); renderAnnotations(); renderReader(); toast('批注已删除。', true); return; }
  if (button?.dataset.searchFile) { const id = button.dataset.searchFile, line = Number(button.dataset.line); openFile(id); const needle = files[id].raw.split('\n')[line - 1].replace(/^#+\s*/, ''); const target = [...article.querySelectorAll('h1,h2,p,li,td')].find(node => node.textContent.includes(needle)); if (target) { target.classList.add('search-hit'); reader.scrollTo({ top: reader.scrollTop + target.getBoundingClientRect().top - reader.getBoundingClientRect().top - 24, behavior: 'instant' }); } if (innerWidth < 900) app.classList.remove('sidebar-drawer'); return; }
  if (button?.dataset.quickFile) { closeModal(); openFile(button.dataset.quickFile); previousFocus = reader; reader.focus(); return; }
  if (button?.hasAttribute('data-open-workspace')) { closeModal(); state.workspace = true; openFile('guide'); setNav('files'); if (innerWidth < 900) app.classList.remove('sidebar-drawer'); return; }
  if (button?.dataset.file) { openFile(button.dataset.file); if (innerWidth < 900) app.classList.remove('sidebar-drawer'); return; }
  if (button?.dataset.tab) { openFile(button.dataset.tab); document.getElementById(`tab-${button.dataset.tab}`)?.focus(); return; }
  if (button?.dataset.closeTab) { closeTab(button.dataset.closeTab); return; }
  if (button?.dataset.section) { goSection(Number(button.dataset.section)); return; }
  if (button?.dataset.nav) { setNav(button.dataset.nav); return; }
  if (button?.dataset.mode) { setMode(button.dataset.mode); return; }
  if (button?.dataset.menu) { if (!popover.hidden && menuTrigger === button) closePopover(); else showMenu(button.dataset.menu, button); return; }
  if (button?.id === 'outline-tab') { setInspector('outline'); return; }
  if (button?.id === 'annotations-tab') { setInspector('annotations'); return; }
  if (button?.dataset.action) { const action = button.dataset.action; closePopover(false); if (modal.open && !modal.contains(button)) closeModal(); actions[action]?.(button); return; }
  if (!popover.contains(event.target)) closePopover(false);
});
editor.addEventListener('input', () => {
  if (!file()) return;
  file().raw = editor.value; file().dirty = file().raw !== file().disk; updateLineNumbers(); renderTabs(); saveStatus();
  clearTimeout(editTimer); editTimer = setTimeout(() => { const top = reader.scrollTop; renderReader(); reader.scrollTop = top; }, 250);
  clearTimeout(draftTimer); document.getElementById('save-status').textContent = '未保存 · 草稿待暂存（演示）'; draftTimer = setTimeout(saveStatus, 500);
});
editor.addEventListener('scroll', () => { document.getElementById('line-numbers').scrollTop = editor.scrollTop; if (file()) file().sourceScroll = editor.scrollTop; });
reader.addEventListener('scroll', () => {
  if (file()) file().scroll = reader.scrollTop;
  const progress = Math.round(reader.scrollTop / Math.max(1, reader.scrollHeight - reader.clientHeight) * 100);
  document.getElementById('reading-progress').textContent = `${progress}%`; document.getElementById('reading-progress-bar').value = progress;
});
document.getElementById('search-start').addEventListener('click', search);
document.getElementById('search-cancel').addEventListener('click', () => cancelSearch());
document.getElementById('search-input').addEventListener('input', () => cancelSearch('按 Enter 重新检索'));
document.getElementById('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
document.getElementById('search-mode').addEventListener('change', () => cancelSearch('检索范围已改变，按 Enter 重新检索'));
document.getElementById('review-scene').addEventListener('change', event => selectScene(event.target.value));
document.addEventListener('input', event => { if (event.target.id === 'quick-input') renderQuick(event.target.value); });
document.addEventListener('change', event => {
  if (event.target.id === 'theme-select') setTheme(event.target.value);
  if (event.target.id === 'paper-width') document.documentElement.style.setProperty('--doc-width', `${event.target.value}px`);
  if (event.target.id === 'paper-theme') {
    if (event.target.value === 'warm') { article.style.setProperty('--paper', '#fcf8ee'); article.style.setProperty('--paper-text', '#433d32'); }
    else { article.style.removeProperty('--paper'); article.style.removeProperty('--paper-text'); }
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (!popover.hidden) { event.preventDefault(); closePopover(); } else if (!modal.open && app.classList.contains('focus-mode')) { event.preventDefault(); app.classList.remove('focus-mode'); } else if (!modal.open) app.classList.remove('sidebar-drawer'); return; }
  if (modal.open && document.getElementById('quick-results') && (event.target.id === 'quick-input' || event.target.closest('#quick-results'))) {
    const items = [...modal.querySelectorAll('#quick-results .quick-item')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const current = items.indexOf(document.activeElement);
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus(); return;
    }
    if (event.key === 'Enter' && event.target.id === 'quick-input') { event.preventDefault(); items[0]?.click(); return; }
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const list = event.target.closest('[role="tablist"]');
    if (list) { const tabs = [...list.querySelectorAll('[role="tab"]')], current = tabs.indexOf(event.target); if (current >= 0) { event.preventDefault(); const target = tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; target.click(); document.getElementById(target.id)?.focus(); } }
  }
  if (!popover.hidden && popover.getAttribute('role') === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const items = [...popover.querySelectorAll('button:not(:disabled)')], current = items.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[index]?.focus(); return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || modal.open) return;
  const key = event.key.toLowerCase();
  const shortcuts = { k: showQuickOpen, p: showQuickOpen, o: () => openPicker(), n: newDocument, ',': () => showSettings(), b: actions['toggle-sidebar'], w: () => { if (state.active) closeTab(state.active); }, s: () => event.shiftKey ? saveCopy() : saveCurrent(), h: actions.find, f: () => event.shiftKey ? setNav('search') : actions.find, enter: () => { if (event.shiftKey) focusMode(); } };
  if (shortcuts[key]) { event.preventDefault(); shortcuts[key](); }
});
window.addEventListener('resize', () => {
  if (innerWidth < 640 && state.mode === 'split') setMode('source');
  // A smaller window collapses auxiliary panes. Only an explicit action opens a drawer.
  document.getElementById('inspector').classList.remove('inspector-overlay');
});
render();
document.documentElement.dataset.designReady = 'true';
