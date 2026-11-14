import { formatLineRef, generateHighlightCSS, parseRemarksFile, truncate, type RemarkColor } from '../../src/ui/remark-utils';
import { annotationBlocks, selectionAnchor, locateAnchor, type LocatedPart } from './annotation-anchors';
import {
  ANNOTATION_DEFAULTS, MAX_ANNOTATIONS, mergeDesktopAnnotations, validAnchor, validAnnotation,
  type AnnotationPreferences, type AnnotationRecord, type DesktopAnnotation,
} from './annotation-data';

type DocumentView = { documentId: string; documentVersion: string; annotationVersion: string; filename: string; readOnly?: boolean };
type SelectionAnchor = NonNullable<ReturnType<typeof selectionAnchor>>;
declare global {
  interface Window {
    desktopApp: {
      state(): { document: DocumentView | null; busy: boolean; preview: { current: boolean } };
      closeTabs(mode: 'current', id: string): Promise<void>;
    };
    desktopShell: { showAnnotations(): void };
  }
}

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const { ui, bindUi } = window.desktopViewer;
const container = element('markdown-content');
const reader = element('reader');
const toolbar = element('annotation-toolbar');
const list = element('annotation-list');
const status = element('annotation-status');
const note = element<HTMLTextAreaElement>('annotation-note');
const noteDialog = element<HTMLDialogElement>('annotation-note-dialog');
const importDialog = element<HTMLDialogElement>('annotation-import-dialog');
const display = {
  color: element<HTMLSelectElement>('annotation-default-color'),
  style: element<HTMLSelectElement>('annotation-style'),
  visible: element<HTMLInputElement>('annotation-visible'),
  closeAfterCopy: element<HTMLInputElement>('annotation-close-after-copy'),
};
const highlightStyle = document.createElement('style');
document.head.append(highlightStyle);
const marks = new Set<HTMLElement>();

let preferences = { ...ANNOTATION_DEFAULTS };
let preferencesReady = false;
let context: DocumentView | null = null;
let blocks: ReturnType<typeof annotationBlocks> = new Map();
let stored: AnnotationRecord | null = null;
let selection: SelectionAnchor | null = null;
let selectedColor: RemarkColor = preferences.color;
let working = false;
let undo: { documentId: string; annotation: DesktopAnnotation } | null = null;
let importDraft: { context: DocumentView; revision: number; merged: DesktopAnnotation[] } | null = null;
let editing: { context: DocumentView; id: string } | null = null;

function sameDocument(first: DocumentView | null, second: DocumentView | null) {
  return first?.documentId === second?.documentId && first?.documentVersion === second?.documentVersion;
}
function ready() {
  const state = window.desktopApp.state();
  return Boolean(context && stored && !state.busy && state.preview.current && sameDocument(context, state.document));
}
function controls() {
  const enabled = ready() && !working;
  const hasEntries = Boolean(stored?.annotations.length);
  for (const id of ['annotation-copy', 'annotation-export']) element<HTMLButtonElement>(id).disabled = !enabled || !hasEntries;
  element<HTMLButtonElement>('annotation-select').disabled = !enabled || !selection;
  element<HTMLButtonElement>('annotation-add').disabled = !enabled || !selection;
  element<HTMLButtonElement>('annotation-import').disabled = !enabled;
  const undoButton = element<HTMLButtonElement>('annotation-undo');
  undoButton.hidden = !undo || undo.documentId !== context?.documentId;
  undoButton.disabled = !enabled;
  for (const button of list.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = !enabled || (button.hasAttribute('data-annotation-relocate') && !selection);
  }
  for (const field of Object.values(display)) field.disabled = !preferencesReady;
}
function clearMarks() {
  const parents = new Set<Node>();
  for (const mark of marks) {
    if (mark.parentNode) parents.add(mark.parentNode);
    mark.replaceWith(...mark.childNodes);
  }
  for (const parent of parents) parent.normalize();
  marks.clear();
}
function markPart(part: LocatedPart, annotation: DesktopAnnotation) {
  if (part.end < part.node.length) part.node.splitText(part.end);
  const text = part.start ? part.node.splitText(part.start) : part.node;
  const mark = document.createElement('mark');
  mark.dataset.desktopRemark = annotation.id;
  mark.className = `remark-ann-${annotation.color}`;
  if (annotation.note) mark.title = annotation.note;
  text.before(mark);
  mark.append(text);
  marks.add(mark);
}
function button(label: string, action: () => void) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', action);
  return node;
}
function renderAnnotations() {
  clearMarks();
  list.replaceChildren();
  if (!context || !stored) { controls(); return; }
  highlightStyle.textContent = generateHighlightCSS(preferences.style)
    .replaceAll('mark.remark-ann-', '#markdown-content mark[data-desktop-remark].remark-ann-');
  for (const annotation of stored.annotations) {
    const parts = locateAnchor(blocks, annotation.anchor, context.annotationVersion);
    if (parts && preferences.visible) {
      for (const part of parts.reverse()) markPart(part, annotation);
    }
    const entry = document.createElement('li');
    entry.dataset.annotationId = annotation.id;
    const quote = parts
      ? button(truncate(annotation.selectedText, 100), () => {
        if (!context) return;
        const target = locateAnchor(blocks, annotation.anchor, context.annotationVersion)?.[0];
        if (!target) return;
        const range = document.createRange();
        range.setStart(target.node, target.start);
        range.setEnd(target.node, target.end);
        const top = range.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop;
        reader.scrollTo({ top: Math.max(0, top - 48), behavior: 'instant' });
      }) : document.createElement('p');
    if (!parts) quote.textContent = truncate(annotation.selectedText, 100);
    quote.className = 'annotation-quote';
    quote.dataset.annotationColor = annotation.color;
    quote.title = annotation.selectedText;
    const meta = document.createElement('small');
    meta.textContent = `${parts ? formatLineRef(annotation.startLine + 1, annotation.endLine + 1) : ui("待重新定位")} · ${new Date(annotation.timestamp).toLocaleString()}`;
    const description = document.createElement('p');
    description.textContent = annotation.note;
    description.hidden = !annotation.note;
    const actions = document.createElement('div');
    actions.className = 'annotation-actions';
    actions.append(button(ui("编辑备注"), () => {
      if (!context || !ready()) return;
      editing = { context, id: annotation.id };
      element<HTMLTextAreaElement>('annotation-note-edit').value = annotation.note;
      noteDialog.showModal();
    }), button(ui("删除"), () => {
      void operate(async selected => {
        await save(selected, stored!.annotations.filter(item => item.id !== annotation.id));
        if (!sameDocument(selected, context)) return;
        const pending = { documentId: selected.documentId, annotation };
        undo = pending;
        setTimeout(() => { if (undo === pending) { undo = null; controls(); } }, 10000);
        bindUi(status, "已删除批注，可在 10 秒内撤销。");
      });
    }));
    if (!parts) {
      const relocate = button(ui("关联当前选区"), () => {
        const target = selection;
        if (!target) return;
        void operate(async selected => {
          await save(selected, stored!.annotations.map(item => item.id === annotation.id ? { ...item, ...target } : item));
          if (sameDocument(selected, context)) {
            clearSelection();
            bindUi(status, "已关联到当前选区。");
          }
        });
      });
      relocate.dataset.annotationRelocate = '';
      actions.append(relocate);
    }
    entry.append(quote, meta, description, actions);
    list.append(entry);
  }
  controls();
}
function clearSelection() {
  selection = null;
  toolbar.hidden = true;
  note.value = '';
  controls();
}
async function load() {
  const selected = window.desktopApp.state().document;
  const next = selected?.readOnly ? null : selected;
  if (next?.documentId !== context?.documentId) undo = null;
  context = next;
  stored = null;
  blocks = next ? annotationBlocks(container) : new Map();
  clearSelection();
  renderAnnotations();
  if (!next) return;
  bindUi(status, "正在读取批注…");
  try {
    const result = await window.desktop.annotations('get', next);
    if (context !== next || !sameDocument(next, window.desktopApp.state().document)) return;
    stored = result;
    renderAnnotations();
    bindUi(status, stored.annotations.length ? "" : "选中正文即可添加批注。");
  } catch (error) {
    if (context === next) bindUi(status, "读取批注失败：{0}", (error as Error).message);
  }
}
async function save(selected: DocumentView, annotations: DesktopAnnotation[]) {
  const result = await window.desktop.annotations('set', { ...selected, revision: stored!.revision, annotations });
  if (sameDocument(selected, context) && sameDocument(selected, window.desktopApp.state().document)) {
    stored = result;
    renderAnnotations();
  }
}
async function operate(action: (selected: DocumentView) => Promise<void>) {
  const selected = context;
  if (!selected || !ready() || working) return;
  working = true; controls();
  try { await action(selected); }
  catch (error) {
    if (sameDocument(selected, context)) bindUi(status, "批注操作失败：{0}", (error as Error).message);
  } finally { working = false; controls(); }
}
function showToolbar(rect: DOMRect) {
  if (!selection || !ready()) return;
  toolbar.hidden = false;
  const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
  toolbar.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  toolbar.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - height - 8))}px`;
}
function chooseColor(color: RemarkColor) {
  selectedColor = color;
  for (const swatch of toolbar.querySelectorAll<HTMLButtonElement>('[data-annotation-color]')) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.annotationColor === color));
  }
}
function capture() {
  const native = window.getSelection();
  if (!ready() || !context || !native?.rangeCount) return;
  const range = native.getRangeAt(0);
  const target = selectionAnchor(container, range, context.annotationVersion);
  if (!target) { clearSelection(); return; }
  selection = target;
  note.value = '';
  chooseColor(preferences.color);
  controls();
  showToolbar(range.getBoundingClientRect());
}
container.addEventListener('pointerdown', clearSelection);
container.addEventListener('pointerup', capture);
document.addEventListener('keyup', event => {
  if ((event.shiftKey || event.key === 'Shift') && !document.querySelector('dialog[open]') && !toolbar.contains(document.activeElement)) capture();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !toolbar.hidden) clearSelection();
});
reader.addEventListener('scroll', () => { toolbar.hidden = true; }, { passive: true });
window.addEventListener('resize', () => { toolbar.hidden = true; });
document.addEventListener('desktop:rendered', () => { void load(); });
document.addEventListener('desktop:locale-changed', renderAnnotations);
document.addEventListener('desktop:changed', () => {
  if (!ready()) clearSelection();
  if (!window.desktopApp.state().document && context) void load();
  controls();
});
for (const swatch of toolbar.querySelectorAll<HTMLButtonElement>('[data-annotation-color]')) {
  swatch.addEventListener('click', () => chooseColor(swatch.dataset.annotationColor as RemarkColor));
}
element('annotation-cancel').addEventListener('click', clearSelection);
element('annotation-select').addEventListener('click', () => {
  const rect = element('annotation-select').getBoundingClientRect();
  showToolbar(rect);
  note.focus({ preventScroll: true });
});
element('annotation-add').addEventListener('click', () => {
  const target = selection;
  if (!target) return;
  const annotation = { ...target, id: crypto.randomUUID(), color: selectedColor, note: note.value.trim(), timestamp: Date.now() };
  void operate(async selected => {
    const { merged, added } = mergeDesktopAnnotations(stored!.annotations, [annotation], () => crypto.randomUUID());
    if (added) await save(selected, merged);
    if (!sameDocument(selected, context)) return;
    window.getSelection()?.removeAllRanges();
    clearSelection();
    window.desktopShell.showAnnotations();
    bindUi(status, added ? "已保存批注。" : "此选区已有批注，可在侧栏编辑备注。");
  });
});
element('annotation-undo').addEventListener('click', () => {
  const pending = undo;
  if (!pending || pending.documentId !== context?.documentId) return;
  void operate(async selected => {
    await save(selected, [...stored!.annotations, pending.annotation]);
    if (!sameDocument(selected, context)) return;
    undo = null;
    bindUi(status, "已撤销删除。");
  });
});
element('annotation-note-save').addEventListener('click', () => {
  const target = editing;
  if (!target || !sameDocument(target.context, context)) { noteDialog.close(); return; }
  const value = element<HTMLTextAreaElement>('annotation-note-edit').value.trim();
  void operate(async selected => {
    await save(selected, stored!.annotations.map(item => item.id === target.id ? { ...item, note: value } : item));
    noteDialog.close();
    if (sameDocument(selected, context)) bindUi(status, "已保存备注。");
  });
});
noteDialog.addEventListener('close', () => { editing = null; });
element('annotation-copy').addEventListener('click', () => {
  void operate(async selected => {
    if (!await window.desktop.annotations('copy', selected) || !sameDocument(selected, context)) return;
    bindUi(status, "已复制结构化批注。");
    if (preferences.closeAfterCopy) await window.desktopApp.closeTabs('current', selected.documentId);
  });
});
element('annotation-export').addEventListener('click', () => {
  void operate(async selected => {
    const saved = await window.desktop.annotations('export', selected);
    if (sameDocument(selected, context) && saved) bindUi(status, "已导出批注文件。");
  });
});
element('annotation-import').addEventListener('click', () => {
  void operate(async selected => {
    const text = await window.desktop.annotations('import', selected);
    if (!text || !sameDocument(selected, context) || !ready()) return;
    const parsed = parseRemarksFile(text);
    if ('error' in parsed) throw Error(ui("请选择有效的 .remarks.json 批注文件"));
    const raw = JSON.parse(text);
    if (raw?.version !== undefined && raw.version !== 1) throw Error(ui("批注文件版本不受支持"));
    if (parsed.annotations.length > MAX_ANNOTATIONS) throw Error(ui("批注数量超过上限"));
    const incoming = parsed.annotations.map(item => {
      const value = raw?.desktopAnchors?.[item.id];
      const id = /^[\w.-]{1,128}$/.test(item.id) ? item.id : crypto.randomUUID();
      const candidate = { ...item, id };
      const anchored = { ...candidate, anchor: validAnchor(value) ? value : undefined };
      return validAnnotation(anchored) ? anchored : candidate;
    }).filter(validAnnotation);
    const { merged, added, skipped } = mergeDesktopAnnotations(stored!.annotations, incoming, () => crypto.randomUUID());
    if (merged.length > MAX_ANNOTATIONS) throw Error(ui("合并后批注数量超过上限"));
    const pending = merged.slice(stored!.annotations.length)
      .filter(item => !locateAnchor(blocks, item.anchor, selected.annotationVersion)).length;
    const invalid = parsed.annotations.length - incoming.length;
    bindUi(element('annotation-import-preview'), "新增 {0} 条，重复 {1} 条，待重新定位 {2} 条{3}。", added, skipped, pending, invalid ? ui("，无效 {0} 条", invalid) : '');
    element<HTMLButtonElement>('annotation-import-confirm').disabled = added === 0;
    importDraft = { context: selected, revision: stored!.revision, merged };
    importDialog.showModal();
  });
});
element('annotation-import-confirm').addEventListener('click', () => {
  const draft = importDraft;
  if (!draft || !sameDocument(draft.context, context) || draft.revision !== stored?.revision) {
    importDialog.close(); return;
  }
  void operate(async selected => {
    await save(selected, draft.merged);
    importDialog.close();
    if (sameDocument(selected, context)) bindUi(status, "已合并导入的批注。");
  });
});
importDialog.addEventListener('close', () => { importDraft = null; });

function showPreferences() {
  display.color.value = preferences.color;
  display.style.value = preferences.style;
  display.visible.checked = preferences.visible;
  display.closeAfterCopy.checked = preferences.closeAfterCopy;
}
for (const field of Object.values(display)) field.addEventListener('change', async () => {
  preferencesReady = false; controls();
  try {
    const result = await window.desktop.preferences('set', { annotations: {
      color: display.color.value as AnnotationPreferences['color'],
      style: display.style.value as AnnotationPreferences['style'],
      visible: display.visible.checked, closeAfterCopy: display.closeAfterCopy.checked,
    } });
    preferences = result.annotations;
    renderAnnotations();
  } catch (error) { bindUi(status, "批注设置保存失败：{0}", (error as Error).message); }
  finally { preferencesReady = true; showPreferences(); controls(); }
});
void window.desktop.preferences('get').then(result => {
  preferences = result.annotations;
  preferencesReady = true;
  showPreferences();
  renderAnnotations();
}).catch(error => { bindUi(status, "批注设置读取失败：{0}", error.message); });
controls();
if (window.desktopApp.state().preview.current) void load();
