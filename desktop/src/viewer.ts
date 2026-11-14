import type { PlatformAPI, DocumentService } from '../../src/types/platform';
import type { RendererThemeConfig } from '../../src/types/render';
import { SettingsService } from '../../src/services/settings-service';
import { normalizeSetting } from '../../src/types/settings';
import settingsSchema from '../../settings-schema.json';
import themeManager from '../../src/utils/theme-manager';
import { renderMarkdownDocument, resetDocument } from '../../src/core/viewer/viewer-controller';
import { getSourceViewContainer, renderSourceView } from '../../src/core/viewer/source-view';
import type { RenderResult } from '../../src/types/render';
import { loadAndApplyTheme } from '../../src/utils/theme-to-css';
import { buildPrintCss } from '../../src/ui/print-utils';
import { LAYOUT_MAX_WIDTHS } from '../../src/ui/layout-presets';
import { clearRenderDiagnostics, getRenderDiagnostics } from '../../src/core/render-diagnostics';
import { clearDiagramExports, getDiagramExport } from '../../src/ui/diagram-export-registry';
import DocxExporter from '../../src/exporters/docx-exporter';
import { exportToHtml } from '../../src/exporters/html-exporter';
import { assetAsPng, inspectDocumentAssets, readAsset, type AssetFormat } from './document-assets';
import { readTable } from './document-tables';
import { ServiceChannel } from '../../src/messaging/channels/service-channel';
import { StorageService } from '../../src/services/storage-service';
import { CacheService } from '../../src/services/cache-service';
import { FileStateService } from '../../src/services/file-state-service';
import { ElectronTransport } from './electron-transport';
import { DesktopI18n } from './i18n';
import { convertLocalHtml } from './html-import';
import { isAbsoluteFilesystemPath, isDocumentRelativeUrl } from '../../src/utils/document-url';
import { prepareSlideDeck, showSlideDeck } from './slidev';
import { desktopFilename } from './desktop-locale';
import { applyDesktopUi, bindUi, bindUiAttribute, ui, uiSource } from './desktop-ui';
import { AsyncTaskManager } from '../../src/core/markdown-processor';
import {summaryTree} from './book-tree';
import {readingFontCSS,type ReadingFontPreferences} from './reading-fonts';
import {setupDiagramPreview} from './diagram-preview';
import { applyCodeBlockCopyLocale, setupCodeBlockCopy } from '../../src/ui/code-block-copy';
import type { AnnotationPreferences, AnnotationRecord, DesktopAnnotation } from './annotation-data';
import type { SettingKey, SettingTypes, SetSettingOptions } from '../../src/types/settings';

interface DocumentInput {
  markdown: string; filename: string; documentPath: string; documentDir: string;
  documentBaseUrl: string; fileReadUrl: string; resourceBaseUrl: string;
  documentId: string; documentVersion: string;
  untitled?: boolean;
  readOnly?: boolean;
  sourceLanguage?: string | null;
  diagramType?: string | null;
  diagramLanguage?: string | null;
  imageUrl?: string | null;
  html?: boolean;
  slidev?: boolean;
}
type HtmlBounds = { x: number; y: number; width: number; height: number };
interface DesktopBridge {
  appInfo(): Promise<{ systemLocale: string }>;
  fullscreen(operation: 'slide-enter' | 'slide-exit'): Promise<void>;
  onFullscreen(handler: (active: boolean) => void): () => void;
  preferences(operation:'get'):Promise<{readingFont:ReadingFontPreferences; annotations:AnnotationPreferences}>;
  preferences(operation:'set', payload:{annotations:AnnotationPreferences}):Promise<{annotations:AnnotationPreferences}>;
  annotations(operation:'get', payload:{documentId:string}):Promise<AnnotationRecord>;
  annotations(operation:'set', payload:{documentId:string;documentVersion:string;revision:number;annotations:DesktopAnnotation[]}):Promise<AnnotationRecord>;
  annotations(operation:'import', payload:{documentId:string;documentVersion:string}):Promise<string|null>;
  annotations(operation:'export'|'copy', payload:{documentId:string;documentVersion:string}):Promise<boolean>;
  state(operation: 'get' | 'set' | 'remove', payload: unknown): Promise<Record<string, unknown>>;
  render(payload: { renderType: string; input: string | object; themeConfig: RendererThemeConfig | null; documentId: string; documentVersion: string }): Promise<RenderResult>;
  service(envelope: unknown): Promise<unknown>;
  onService(handler: (message: unknown) => void): () => void;
  htmlPreview(operation: 'open' | 'resize', payload: { documentId: string; documentVersion: string; bounds?: HtmlBounds | null }): Promise<void>;
  imageAction(payload: { documentId: string; documentVersion: string; token: string | null; action: 'copy' | 'save';
    format: AssetFormat; name: string; base64: string; mime: string }): Promise<{ path?: string; copied?: boolean; canceled?: boolean }>;
  copyCode(payload: { documentId: string; documentVersion: string; token: string | null; text: string }): Promise<void>;
  tableAction(payload: { documentId: string; documentVersion: string; token: string | null } & ReturnType<typeof readTable>):
    Promise<{ path?: string; copied?: boolean; canceled?: boolean }>;
}
declare global {
  interface Window {
    desktop: DesktopBridge;
    desktopViewer: typeof viewer;
  }
}

let input: DocumentInput;
let assetDocument: DocumentInput | null = null;
let exportAssets: Awaited<ReturnType<typeof inspectDocumentAssets>> | null = null;
let hasDocument = false;
let exportSettings: Record<string, unknown> | null = null;
let theme: RendererThemeConfig | null = null;
let download: Blob | null = null;
const channel = location.hostname === 'viewer' ? new ServiceChannel(new ElectronTransport(window.desktop), { source: 'desktop', timeoutMs: 30000 }) : null;
const hostStorage = channel ? new StorageService(channel) : null;
const hostCache = channel ? new CacheService(channel) : null;
const hostFileState = channel ? new FileStateService(channel) : null;
const i18n = new DesktopI18n();
let restoring = true;
let readingTimer: ReturnType<typeof setTimeout> | undefined;
type ReadingView = { layoutMode: keyof typeof LAYOUT_MAX_WIDTHS; zoom: number };
type DocumentMode = 'reading' | 'split' | 'source';
let documentMode: DocumentMode | null = null;
const defaultReadingView: ReadingView = { layoutMode: 'normal', zoom: 1 };
let readingView = { ...defaultReadingView };
let readingTop = 0;
let previewTasks: AsyncTaskManager | null = null;
let sourceEntries: {element:HTMLElement;start:number;count:number}[] = [];
let diagramPreview:ReturnType<typeof setupDiagramPreview>|null=null;
let stopHtmlLayout: (() => void) | undefined;
let slideController: AbortController | undefined;
let slideStatus: { issues: number; fallback: boolean } | null = null;
const displayImages = new Set<string>();
let displayOriginals = new WeakMap<HTMLImageElement,string>();
function clearDisplayImages() {
  for(const url of displayImages)URL.revokeObjectURL(url);
  displayImages.clear();
  displayOriginals = new WeakMap();
}
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const storage: PlatformAPI['storage'] = {
  get: keys => exportSettings ? Promise.resolve(Object.fromEntries(keys.map(key => [key, exportSettings![key]]))) : hostStorage!.get(keys),
  set: async values => { if (exportSettings) throw new Error('Export settings are read-only'); await hostStorage!.set(values); },
  remove: async keys => { if (exportSettings) throw new Error('Export settings are read-only'); await hostStorage!.remove(keys); },
};
class DesktopSettings extends SettingsService {
  private writes: Promise<void> = Promise.resolve();
  override set<K extends SettingKey>(key: K, value: SettingTypes[K], options?: SetSettingOptions): Promise<void> {
    const pending = this.writes.then(() => super.set(key, value, options));
    this.writes = pending.catch(() => {});
    return pending;
  }
  setMany(values: Partial<SettingTypes>): Promise<void> {
    const pending = this.writes.then(async () => {
      for (const [key, value] of Object.entries(values)) {
        const rule = settingsSchema.settings.find(item => item.key === key && !item.cliOnly);
        if (!rule || normalizeSetting(key as SettingKey, value) !== value) throw Error(`Invalid setting: ${key}`);
      }
      if (values.themeId && !(await themeManager.getAvailableThemes()).some(item => item.id === values.themeId)) {
        throw Error('Unsupported document theme');
      }
      const current = await this.getAll();
      await storage.set({ markdownViewerSettings: { ...current, ...values } });
    });
    this.writes = pending.catch(() => {});
    return pending;
  }
}
const settings = new DesktopSettings({ storage });
const resourceUrl = (value: string, selected = input) => {
  if(selected?.untitled)throw Error(ui("未命名文档尚无资源目录，请先保存后引用本机文件"));
  const url = new URL(selected.fileReadUrl);
  if (/^documd:/i.test(value)) {
    const resolved = new URL(value);
    const prefix = `${new URL(selected.documentBaseUrl).pathname.split('/').slice(0, 3).join('/')}/`;
    if (resolved.host === url.host && (resolved.pathname.startsWith(prefix)
      || (resolved.pathname === url.pathname && resolved.searchParams.get('token') === url.searchParams.get('token')))) return resolved.href;
    throw Error('Resource URL does not belong to the current document');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^(?:file:|[a-z]:[\\/])/i.test(value)) throw Error('Only local document resources are supported');
  // Keep the authored path intact across the protocol boundary: URL pathname
  // normalization would erase ../ segments above the original document root.
  url.searchParams.set(/^(?:file:|[a-z]:[\\/]|[\\/])/i.test(value) ? 'path' : 'relative', value);
  return url.href;
};
async function read(url: string, binary = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Resource unavailable (${response.status})`);
  if (!binary) return response.text();
  return base64(new Uint8Array(await response.arrayBuffer()));
}
function base64(bytes: Uint8Array) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(result);
}
async function embedHtmlImage(source: string) {
  const response = await fetch(resourceUrl(source));
  const type = response.headers.get('Content-Type')?.split(';')[0];
  if (!response.ok || !type?.startsWith('image/')) throw Error('Image is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw Error('Image is empty');
  return `data:${type};base64,${base64(bytes)}`;
}
const documentService: DocumentService = {
  get documentPath() { return hasDocument ? input.documentPath : ''; },
  get documentDir() { return hasDocument ? input.documentDir : ''; },
  get baseUrl() { return hasDocument ? input.documentBaseUrl : ''; },
  needsUriRewrite: false,
  readFile: (value, options) => read(resourceUrl(value), options?.binary),
  readRelativeFile: (value, options) => read(resourceUrl(value), options?.binary),
  resolvePath: value => resourceUrl(value),
  toResourceUrl: resourceUrl,
  setDocumentPath: (path, baseUrl) => { input = { ...input, documentPath: path, ...(baseUrl ? { documentBaseUrl: baseUrl } : {}) }; },
};
const platform: PlatformAPI = {
  platform: 'desktop', storage, settings, document: documentService,
  resource: {
    getURL: value => new URL(value, `${location.origin}/assets/`).href,
    fetch: value => read(new URL(value, `${location.origin}/assets/`).href),
  },
  renderer: {
    init: async () => {},
    setThemeConfig: value => { theme = value; }, getThemeConfig: () => theme,
    render: (type, content) => window.desktop.render({ renderType: type, input: content, themeConfig: theme, documentId: input.documentId, documentVersion: input.documentVersion }),
  },
  file: { download: async blob => { download = typeof blob === 'string' ? new Blob([blob]) : blob; } },
  cache: {
    init: async () => {}, calculateHash: hash,
    generateKey: (content, type, config) => hash(JSON.stringify([content, type, config, input?.documentVersion])),
    get: async key => hostCache?.get(key) ?? null,
    set: async (key, value, type) => hostCache ? hostCache.set(key, value, type) : false,
    clear: async () => hostCache ? hostCache.clear() : false, getStats: async () => hostCache?.getStats() ?? null,
  },
  fileState: {
    get: async key => hostFileState?.get(key) ?? {}, set: (key, value) => { hostFileState?.set(key, value); },
    clear: async key => { await hostFileState?.clear(key); },
  },
  i18n,
  message: {
    send: message => { if (!channel || typeof message.type !== 'string') return Promise.reject(Error('Invalid desktop message')); return channel.send(message.type, message.payload ?? {}); },
    addListener: handler => { channel?.onAny(handler); },
  },
};
globalThis.platform = platform;

function prepareSlides(selected: DocumentInput, signal?: AbortSignal) {
  input = selected;
  return prepareSlideDeck(selected.markdown, {
    signal,
    readImage: (source, signal) => {
      if (!source || /^(?:[a-z][a-z\d+.-]*:|[\\/#?])|[\u0000-\u001f]/i.test(source)) throw Error('Expected a relative image path');
      const url = new URL(resourceUrl(source, selected));
      url.searchParams.set('slide-image', '1');
      return fetch(url, { signal });
    },
    render: (type, source, theme) => window.desktop.render({ renderType: type, input: source,
      themeConfig: { fontFamily: theme.fonts?.sans || theme.fonts?.serif, colorSchema: theme.colorSchema },
      documentId: selected.documentId, documentVersion: selected.documentVersion }),
  });
}

function indexSource(container:HTMLElement) {
  sourceEntries = Array.from(container.querySelectorAll<HTMLElement>('.md-block[data-line]'),element=>({
    element,start:Number(element.dataset.line),count:Number(element.dataset.lineCount||1),
  }));
}
function resolvePreviewImages(container: HTMLElement, selected: DocumentInput) {
  if (selected.untitled) return;
  for (const image of container.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src');
    if (source && (isDocumentRelativeUrl(source) || isAbsoluteFilesystemPath(source)) && !source.startsWith('//')) {
      image.setAttribute('src', resourceUrl(source, selected));
    }
  }
}
async function layoutDocumentPng() {
  const page = document.getElementById('markdown-page')!;
  const content = document.getElementById('markdown-content')!;
  const style = document.createElement('style');
  // Screen styles preserve the theme. Only remove scroll containers and wrap
  // content that otherwise cannot fit in a static image.
  style.textContent = `
    html, body { box-sizing: border-box; margin: 0 !important; height: auto !important;
      min-height: 0 !important; overflow: visible !important; }
    body { padding: 24px 40px !important; }
    #markdown-content { overflow-wrap: anywhere; }
    #markdown-content :is(img, svg, pre, .diagram-block) { max-width: 100% !important; }
    #markdown-content :is(pre, pre code) { white-space: pre-wrap !important;
      overflow-wrap: anywhere !important; overflow: visible !important; }
    #markdown-content :is(th, td) { min-width: 0 !important; overflow-wrap: anywhere !important; white-space: normal; }
    #markdown-content :is(.mv-code-copy-btn, .desktop-diagram-open) { display: none !important; }
  `;
  document.head.append(style);
  await document.fonts.ready;
  for (const table of content.querySelectorAll<HTMLTableElement>('table')) {
    if (table.getBoundingClientRect().width <= content.clientWidth + 1) continue;
    table.style.setProperty('width', '100%', 'important');
    table.style.setProperty('table-layout', 'fixed', 'important');
  }
  const width = window.innerWidth;
  const clipped = Array.from(content.querySelectorAll<HTMLElement>('pre, table, .katex-display, .diagram-block'))
    .some(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2);
  if (clipped || document.body.scrollWidth > width + 2 || page.scrollWidth > page.clientWidth + 2) {
    throw Error(ui('部分内容太宽，无法完整导出 PNG。请缩短长公式或调整表格后重试。'));
  }
  return { width, height: Math.ceil(document.body.getBoundingClientRect().height) };
}
function renderableMarkdown(selected: DocumentInput) {
  if (!selected.diagramType) return selected.markdown;
  if (!selected.markdown.trim()) throw Error(ui('图表文件没有内容'));
  // Preserve literal fences in diagram text, including lines inside XML/JSON strings.
  let length = 3;
  for (const run of selected.markdown.matchAll(/`{3,}/g)) length = Math.max(length, run[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${selected.diagramType}\n${selected.markdown}\n${fence}`;
}
function showSource(content: string, language: string, container: HTMLElement) {
  content = content.replace(/\r\n?/g, '\n');
  if (content.length <= 256 * 1024 && content.split('\n', 10001).length <= 10000) {
    renderSourceView({ content, language });
  } else {
    const surface = document.createElement('div');
    surface.className = 'markdown-viewer-content';
    const pre = document.createElement('pre');
    pre.className = 'mv-source-pre';
    const code = document.createElement('code');
    code.textContent = content;
    pre.append(code);
    surface.append(pre);
    container.replaceChildren(surface);
  }
}
function toggleDiagramSource(): boolean {
  const source = getSourceViewContainer();
  if (!hasDocument || !input.diagramType || !source) return false;
  const show = source.hidden;
  if (show && !source.childElementCount) showSource(input.markdown, input.diagramLanguage || 'plaintext', source);
  source.hidden = !show;
  document.getElementById('markdown-content')!.hidden = show;
  return show;
}
function fontStyle(id:string,css:string) {
  let style=document.getElementById(id) as HTMLStyleElement|null;
  if(!style){style=document.createElement('style');style.id=id;document.head.append(style);}
  style.textContent=css;
}
async function configureReadingFont(font:ReadingFontPreferences) {
  const selected=input?.documentId,line=hasDocument?previewLine():null;
  fontStyle('desktop-reading-font',readingFontCSS(font,'#reader #markdown-content','DocumdReader'));
  await document.fonts.ready;
  if(line!==null&&hasDocument&&selected===input?.documentId)revealLine(line);
}
async function sizeDisplayDiagrams(container:HTMLElement,check:()=>void) {
  const pageStyle=getComputedStyle(document.getElementById('markdown-page')!);
  const pageWidth=parseFloat(pageStyle.maxWidth)-parseFloat(pageStyle.paddingLeft)-parseFloat(pageStyle.paddingRight);
  for(const image of container.querySelectorAll<HTMLImageElement>('.diagram-block img')) {
    if(!image.src.startsWith('data:image/png'))continue;
    await image.decode();check();
    const original=image.src,width=image.naturalWidth,height=image.naturalHeight;
    const target=Math.min(width,Math.ceil(Math.max(image.getBoundingClientRect().width,Number.isFinite(pageWidth)?pageWidth:0)*devicePixelRatio));
    if(target<=0||width<=target*1.5)continue;
    const canvas=document.createElement('canvas');canvas.width=target;canvas.height=Math.max(1,Math.round(height*target/width));
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)continue;
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));check();
    if(!blob)continue;
    const url=URL.createObjectURL(blob);displayImages.add(url);
    // Only the screen image is reduced. Preserve the original PNG for asset
    // consumers; SVG registry and isolated document exports remain unchanged.
    displayOriginals.set(image,original);
    image.style.aspectRatio=`${width} / ${height}`;image.src=url;
    try {await image.decode();check();}
    catch(error){image.src=original;displayOriginals.delete(image);URL.revokeObjectURL(url);displayImages.delete(url);check();}
  }
}
async function snapshotDom(selected: DocumentInput) {
  assetDocument = null;
  const tasks = new AsyncTaskManager((key, substitutions) => i18n.translate(key, substitutions) || key, { maxConcurrentTasks: 4 });
  previewTasks = tasks;
  const check = () => { if (tasks.isAborted()) throw new Error('Preview superseded'); };
  restoring = true;
  input = selected;
  hasDocument = true;
  resetDocument(); clearRenderDiagnostics(); clearDiagramExports(); theme = null;
  const container = document.getElementById('markdown-content')!;
  const sourceView = getSourceViewContainer();
  const imageView = document.getElementById('image-file-view');
  const htmlView = document.getElementById('html-file-view');
  const slideView = document.getElementById('slidev-view');
  slideController?.abort(); slideController = undefined; slideStatus = null;
  stopHtmlLayout?.();
  stopHtmlLayout = undefined;
  diagramPreview?.close();
  sourceEntries = [];
  container.replaceChildren();
  clearDisplayImages();
  container.hidden = Boolean(selected.readOnly && !selected.diagramType);
  if (htmlView) htmlView.hidden = !selected.html;
  if (slideView) slideView.hidden = !selected.slidev;
  if (imageView) {
    imageView.hidden = !selected.imageUrl;
    imageView.replaceChildren();
  }
  if (sourceView) {
    sourceView.hidden = !selected.sourceLanguage;
    sourceView.replaceChildren();
  }
  if (selected.html && htmlView) {
    const { documentId, documentVersion } = selected;
    await window.desktop.htmlPreview('open', { documentId, documentVersion });
    check();
    stopHtmlLayout = positionHtmlPreview(htmlView, { documentId, documentVersion });
    return;
  }
  if (selected.slidev && slideView) {
    const controller = new AbortController();
    slideController = controller;
    const deck = await prepareSlides(selected, controller.signal);
    check();
    await showSlideDeck(slideView, deck, controller.signal, {
      set: active => window.desktop.fullscreen(active ? 'slide-enter' : 'slide-exit'),
      onChange: callback => window.desktop.onFullscreen(callback),
    });
    slideStatus = { issues: deck.issues, fallback: deck.fallback };
    return;
  }
  if (selected.imageUrl && imageView) {
    const image = document.createElement('img');
    image.alt = selected.filename;
    image.src = selected.imageUrl;
    try { await image.decode(); }
    catch { throw new Error(ui("图片无法加载：{0}", selected.filename)); }
    check();
    const figure = document.createElement('figure');
    figure.className = 'diagram-block desktop-image-file';
    const dimensions = document.createElement('figcaption');
    dimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
    figure.append(image, dimensions);
    imageView.append(figure);
    diagramPreview?.decorate();
    return;
  }
  if (selected.sourceLanguage && sourceView) {
    await loadAndApplyTheme(await settings.get('themeId'));
    check();
    showSource(selected.markdown, selected.sourceLanguage, sourceView);
    await document.fonts.ready;
    check();
    return;
  }
  for (const prefix of ['table-layout-', 'image-layout-', 'diagram-layout-']) {
    for (const name of Array.from(container.classList)) if (name.startsWith(prefix)) container.classList.remove(name);
  }
  container.classList.add(`table-layout-${await settings.get('tableLayout')}`,
    `image-layout-${await settings.get('imageLayout')}`, `diagram-layout-${await settings.get('diagramLayout')}`);
  await loadAndApplyTheme(await settings.get('themeId'));
  await i18n.setLocale(await settings.get('preferredLocale'));
  check();
  const result = await renderMarkdownDocument({
    markdown: renderableMarkdown(selected), container, renderer: platform.renderer, translate: (key, substitutions) => i18n.translate(key, substitutions) || key,
    frontmatterDisplay: await settings.get('frontmatterDisplay'),
    tableMergeEmpty: await settings.get('tableMergeEmpty'), tableLayout: await settings.get('tableLayout'),
    taskManager: tasks,
    rewriteObsidianSyntax: false,
    // Keep source positioning available while later diagrams are still rendering.
    onChunkComplete:()=>{if(!tasks.isAborted()){resolvePreviewImages(container, selected);indexSource(container);}},
    onStreamingComplete:()=>{if(!tasks.isAborted())indexSource(container);},
  });
  check();
  await result.taskManager.processAll();
  check();
  resolvePreviewImages(container, selected);
  // Allow cells to wrap and reduce horizontal padding as columns get narrower.
  // Retain a local overflow fallback for indivisible media, not ordinary text.
  // Export snapshots retain their original DOM and pagination styles.
  if (location.hostname === 'viewer') {
    for (const table of container.querySelectorAll('table')) {
      if (table.parentElement?.classList.contains('desktop-table-scroll')) continue;
      const scroll = document.createElement('div');
      scroll.className = 'desktop-table-scroll';
      const columns = Array.from(table.rows).reduce((maximum, row) => Math.max(maximum,
        Array.from(row.cells).reduce((count, cell) => count + cell.colSpan, 0)), 1);
      scroll.style.setProperty('--desktop-table-columns', String(columns));
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      bindUiAttribute(scroll, 'aria-label', "表格");
      table.before(scroll);
      scroll.append(table);
    }
  }
  await document.fonts.ready;
  check();
  if(location.hostname==='viewer')await sizeDisplayDiagrams(container,check);
  check();
  diagramPreview?.decorate();
  if (channel) for (const image of container.querySelectorAll<HTMLImageElement>('img')) {
    if (!image.closest('.diagram-block, a[href], button') && !image.hasAttribute('tabindex')) image.tabIndex = 0;
  }
  indexSource(container);
  assetDocument = selected;
}

function assetsReady(selected?: DocumentInput | null) {
  return Boolean(selected && assetDocument && selected.documentId === assetDocument.documentId
    && selected.documentVersion === assetDocument.documentVersion && selected.fileReadUrl === assetDocument.fileReadUrl);
}
function positionHtmlPreview(view: HTMLElement, identity: { documentId: string; documentVersion: string }) {
  let scheduled = false;
  let stopped = false;
  let previous = '';
  const update = () => {
    scheduled = false;
    if (stopped) return;
    const rect = view.getBoundingClientRect();
    const overlay = document.querySelector('dialog[open], #shell-popover:not([hidden]), #desktop-app.sidebar-drawer, #drop-overlay:not([hidden])');
    const bounds = view.hidden || overlay || rect.width < 1 || rect.height < 1 ? null : {
      x: Math.ceil(rect.left), y: Math.ceil(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height),
    };
    const key = JSON.stringify(bounds);
    if (key === previous) return;
    previous = key;
    void window.desktop.htmlPreview('resize', { ...identity, bounds }).catch(error => console.error('HTML preview layout failed', error));
  };
  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(update);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(view);
  window.addEventListener('resize', schedule);
  const overlays = new MutationObserver(schedule);
  overlays.observe(document.getElementById('desktop-app')!, {
    subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'],
  });
  schedule();
  return () => {
    stopped = true;
    resize.disconnect();
    overlays.disconnect();
    window.removeEventListener('resize', schedule);
  };
}
function sourceTarget(line:number) {
  const zero=Math.max(0,line-1);let low=0,high=sourceEntries.length;
  while(low<high){const middle=(low+high)>>>1;if(sourceEntries[middle].start<=zero)low=middle+1;else high=middle;}
  return sourceEntries[Math.max(0,low-1)]?.element;
}
function previewLine() {
  const reader=document.getElementById('reader');if(!hasDocument||!reader)return null;
  const top=reader.getBoundingClientRect().top+12;let low=0,high=sourceEntries.length;
  // Read only O(log n) live positions, so resize/image reflow needs no stale
  // cached offsets and scrolling never walks the entire rendered document.
  while(low<high){const middle=(low+high)>>>1;if(sourceEntries[middle].element.getBoundingClientRect().top<=top)low=middle+1;else high=middle;}
  let index=Math.max(0,low-1),entry=sourceEntries[index];if(!entry)return null;
  let rect=entry.element.getBoundingClientRect();
  while(rect.height===0&&index>0){entry=sourceEntries[--index];rect=entry.element.getBoundingClientRect();}
  const fraction=Math.max(0,Math.min(.999,(top-rect.top)/Math.max(1,rect.height)));
  return entry.start+1+fraction*entry.count;
}
function revealLine(line:number,highlight=false) {
  if(!hasDocument||!Number.isFinite(line)||line<1)return;
  const target=sourceTarget(line),reader=document.getElementById('reader');if(!target||!reader)return;
  if(highlight){document.querySelector('.search-line-target')?.classList.remove('search-line-target');target.classList.add('search-line-target');}
  const fraction=Math.max(0,Math.min(.999,(line-1-Number(target.dataset.line))/Number(target.dataset.lineCount||1)));
  reader.scrollTo({top:Math.max(0,reader.scrollTop+target.getBoundingClientRect().top-reader.getBoundingClientRect().top-12+target.getBoundingClientRect().height*fraction),behavior:'instant'});
}
function readingPosition() {
  const reader = document.getElementById('reader');
  if (!restoring && reader?.getClientRects().length) readingTop = reader.scrollTop;
  return readingTop;
}
function scrollReader(top: number) {
  readingTop = top;
  const reader = document.getElementById('reader');
  if (reader?.getClientRects().length) {
    reader.scrollTo({ top, behavior: 'instant' });
    readingTop = reader.scrollTop;
  }
}
function applyReadingView() {
  const page = document.getElementById('markdown-page')!;
  if (readingView.layoutMode === 'normal') page.style.removeProperty('max-width');
  else page.style.maxWidth = LAYOUT_MAX_WIDTHS[readingView.layoutMode];
  document.getElementById('markdown-content')!.style.setProperty('zoom', String(readingView.zoom));
  getSourceViewContainer()?.style.setProperty('zoom', String(readingView.zoom));
  document.getElementById('image-file-view')?.style.setProperty('zoom', String(readingView.zoom));
  document.dispatchEvent(new Event('desktop:reading-view'));
}
function tableContext(table: HTMLTableElement, selected?: DocumentInput | null) {
  return Boolean(channel && assetsReady(selected) && table.isConnected && table.rows.length && table.closest('#markdown-content'));
}
function imageContext(image: HTMLImageElement, selected?: DocumentInput | null) {
  if (!channel || !selected || !image.isConnected || !image.naturalWidth) return null;
  const standalone = Boolean(selected.imageUrl && input?.fileReadUrl === selected.fileReadUrl && hasDocument
    && image.closest('#image-file-view') && image.src === selected.imageUrl);
  if (!standalone && (!image.closest('#markdown-content') || !assetsReady(selected))) return null;
  const source = displayOriginals.get(image) || image.getAttribute('src') || '';
  if (!source) return null;
  const block = image.closest<HTMLElement>('.diagram-block');
  const diagram = !standalone && Boolean(block || image.dataset.pluginRendered === 'true');
  const hash = block?.dataset.sourceHash || image.dataset.sourceHash;
  const vector = diagram && hash ? getDiagramExport(hash) : undefined;
  const formats: AssetFormat[] = diagram ? ['png'] : ['original'];
  if (vector?.svg) formats.push('svg');
  if (vector?.drawioXml) formats.push('drawio');
  let name = standalone ? selected.filename : 'image';
  if (diagram) name = block?.dataset.pluginType || image.dataset.pluginType || 'diagram';
  else if (!standalone && source.startsWith('documd:')) {
    const url = new URL(source);
    const relative = url.searchParams.get('relative') || url.searchParams.get('path') || url.pathname;
    name = relative.split(/[\\/]/).pop() || name;
    try { name = decodeURIComponent(name); } catch { /* Keep a literal percent sign. */ }
  }
  return { source, standalone, diagram, vector, formats, name: diagram ? name : name.replace(/\.[^.]+$/, '') || 'image' };
}
function reflowReader(change: () => void) {
  const reader = document.getElementById('reader');
  if (!hasDocument || restoring || !reader) { change(); return; }
  const top = readingPosition();
  const anchor = reader.getClientRects().length && top > 0 ? previewLine() : null;
  change();
  if (anchor !== null && reader.getClientRects().length) {
    revealLine(anchor);
    readingTop = reader.scrollTop;
  } else scrollReader(top);
}
const viewer = {
  tableContext,
  tableAction(table: HTMLTableElement, selected: DocumentInput, action: 'copy' | 'save') {
    if (!tableContext(table, selected)) throw Error(ui('请先更新当前文档预览'));
    const data = readTable(table, document.getElementById('markdown-content')!, action, base64);
    return window.desktop.tableAction({ ...data, documentId: selected.documentId, documentVersion: selected.documentVersion,
      token: new URL(selected.fileReadUrl).searchParams.get('token') });
  },
  imageContext: (image: HTMLImageElement, selected?: DocumentInput | null) => imageContext(image, selected)?.formats,
  async imageAction(image: HTMLImageElement, selected: DocumentInput, choice: AssetFormat | 'copy') {
    const asset = imageContext(image, selected);
    if (!asset || (choice !== 'copy' && !asset.formats.includes(choice))) throw Error(ui('该资产不支持所选格式'));
    const format = choice === 'copy' ? asset.diagram ? 'png' : 'original' : choice;
    const resolve = (source: string) => asset.standalone && source === selected.imageUrl ? source : resourceUrl(source, selected);
    let data = await readAsset({ image, vector: asset.vector }, format, resolve, base64, asset.source);
    if (choice === 'copy') data = await assetAsPng(data, base64);
    if (imageContext(image, selected)?.source !== asset.source) throw Error(ui('请先更新当前文档预览'));
    return window.desktop.imageAction({ ...data, name: asset.name,
      action: choice === 'copy' ? 'copy' : 'save', format: choice === 'copy' ? 'png' : format,
      documentId: selected.documentId, documentVersion: selected.documentVersion,
      token: new URL(selected.fileReadUrl).searchParams.get('token') });
  },
  assetsReady,
  async listAssets(selected: DocumentInput) {
    if (!assetsReady(selected)) throw Error(ui('请先更新当前文档预览'));
    const assets = await inspectDocumentAssets(document.getElementById('markdown-content')!);
    if (!assetsReady(selected)) throw Error(ui('请先更新当前文档预览'));
    return assets.map(asset => asset.entry);
  },
  async readExportAsset(index: number, key: string, format: AssetFormat) {
    if (location.hostname !== 'export' || !exportAssets) throw Error('Asset export host is not ready');
    const asset = exportAssets[index - 1];
    if (!asset || asset.entry.key !== key) throw Error(ui('资产已变化，请刷新清单后重试'));
    if (asset.entry.error) throw Error(asset.entry.error);
    if (!asset.entry.formats.includes(format)) throw Error(ui('该资产不支持所选格式'));
    return readAsset(asset, format, resourceUrl, base64);
  },
  convertLocalHtml,
  toggleDiagramSource,
  slideStatus: () => slideStatus,
  applyDesktopUi, bindUi, bindUiAttribute, ui, uiSource,
  uiFilename: (item: { filename: string; untitled?: boolean }) => desktopFilename(i18n.getUILanguage(), item.filename, item.untitled),
  async settingsForm() {
    return {
      rules: settingsSchema.settings.filter(rule => !rule.cliOnly),
      themes: await themeManager.getAvailableThemes(),
      values: await settings.getAll(),
    };
  },
  saveSettings: (values: Partial<SettingTypes>) => settings.setMany(values),
  configureReadingFont,
  previewReadingFont:(font:ReadingFontPreferences)=>fontStyle('desktop-reading-sample',readingFontCSS(font,'#reader-font-sample','DocumdSample')),
  originalImageSource:(image:HTMLImageElement)=>displayOriginals.get(image)||image.src,
  summaryTree,
  snapshotDom,
  cancelPreview(){previewTasks?.abort();if (!slideStatus) slideController?.abort();},
  sourceLine:previewLine,
  revealLine,
  readingView: () => ({ ...readingView }),
  readingPosition,
  scrollReader,
  reflowReader,
  documentMode: () => documentMode,
  rememberDocumentMode: (mode: DocumentMode) => { documentMode = mode; },
  async prepareReadingState(id: string) {
    restoring = true;
    clearTimeout(readingTimer);
    const saved = await platform.fileState.get(id);
    const { layoutMode, zoom, scrollTop } = saved;
    const mode = saved.documentMode;
    documentMode = mode === 'reading' || mode === 'split' || mode === 'source' ? mode : null;
    readingView = {
      layoutMode: layoutMode === 'fullscreen' || layoutMode === 'narrow' ? layoutMode : 'normal',
      zoom: typeof zoom === 'number' && zoom >= 0.25 && zoom <= 4 ? zoom : 1,
    };
    readingTop = typeof scrollTop === 'number' && Number.isFinite(scrollTop) ? scrollTop : 0;
    applyReadingView();
  },
  async setReadingView(change: Partial<ReadingView>) {
    if (!hasDocument || restoring) return;
    reflowReader(() => {
      readingView = { ...readingView, ...change };
      applyReadingView();
    });
    await viewer.saveReadingState();
  },
  finishPreview(line:number|null,top:number){
    const reader=document.getElementById('reader');
    if(reader?.getClientRects().length) {
      if(line!==null)revealLine(line);else scrollReader(top);
    }
    restoring=false;
  },
  clear() {
    assetDocument = null;
    diagramPreview?.close();
    sourceEntries = [];
    clearTimeout(readingTimer); restoring = true; hasDocument = false;
    readingView = { ...defaultReadingView }; readingTop = 0; documentMode = null;
    applyReadingView();
    resetDocument(); clearRenderDiagnostics(); clearDiagramExports();
    const content = document.getElementById('markdown-content')!;
    content.hidden = false;
    content.replaceChildren();
    const sourceView = getSourceViewContainer();
    if (sourceView) { sourceView.hidden = true; sourceView.replaceChildren(); }
    const imageView = document.getElementById('image-file-view');
    if (imageView) { imageView.hidden = true; imageView.replaceChildren(); }
    const htmlView = document.getElementById('html-file-view');
    if (htmlView) htmlView.hidden = true;
    const slideView = document.getElementById('slidev-view');
    if (slideView) slideView.hidden = true;
    slideController?.abort(); slideController = undefined; slideStatus = null;
    stopHtmlLayout?.();
    stopHtmlLayout = undefined;
    clearDisplayImages();
  },
  async init() {
    if (channel) i18n.systemLocale = (await window.desktop.appInfo()).systemLocale;
    await i18n.setLocale(await settings.get('preferredLocale'));
    if(channel){
      await configureReadingFont((await window.desktop.preferences('get')).readingFont);
      const content = document.getElementById('markdown-content')!;
      const translate = (key: string) => i18n.translate(key) || key;
      setupCodeBlockCopy({ container: content, translate, copyText: text => {
        if (!hasDocument || !input) return Promise.reject(Error(ui('无法复制代码')));
        return window.desktop.copyCode({ documentId: input.documentId, documentVersion: input.documentVersion,
          token: new URL(input.fileReadUrl).searchParams.get('token'), text });
      } });
      document.addEventListener('desktop:locale-changed', () => applyCodeBlockCopyLocale(content, translate));
      diagramPreview=setupDiagramPreview([
        content, document.getElementById('image-file-view')!,
      ],image=>{
        const hash=image.dataset.sourceHash||image.closest<HTMLElement>('.diagram-block')?.dataset.sourceHash;
        const svg=hash?getDiagramExport(hash)?.svg:undefined;
        return {source:svg||displayOriginals.get(image)||image.src,vector:Boolean(svg)};
      });
    }
  },
  async saveReadingState() {
    clearTimeout(readingTimer);
    if (!channel || !input || restoring) return;
    await channel.send('FILE_STATE_OPERATION', { operation: 'set', url: input.documentId,
      state: { ...readingView, scrollTop: readingPosition(), ...(documentMode ? { documentMode } : {}) } });
  },
  restoreReadingState(top = readingTop) {
    scrollReader(top);
    restoring = false;
  },
  jumpToLine(line: number) {
    if (Number.isInteger(line)) revealLine(line,true);
  },
  locales: () => i18n.locales,
  diagnostics: getRenderDiagnostics,
  async renderDocx(selected: DocumentInput) {
    if (location.hostname !== 'export') throw new Error('DOCX generation requires the export host');
    input = selected; download = null; clearRenderDiagnostics();
    const result = await new DocxExporter(platform.renderer, { rewriteObsidianSyntax: false })
      .exportToDocx(renderableMarkdown(selected), selected.filename);
    if (!result.success) throw new Error(result.error || 'DOCX export failed');
    const blob = download as Blob | null;
    if (!blob) throw new Error('DOCX exporter did not produce a file');
    return { base64: base64(new Uint8Array(await blob.arrayBuffer())) };
  },
  async exportDocument(selected: DocumentInput & { format: 'docx' | 'pdf' | 'html' | 'png' | 'assets'; settingsSnapshot: Record<string, unknown>; systemLocale: string; pdfPageCss?: string }) {
    if (location.hostname !== 'export') throw new Error('Exports require the isolated export host');
    exportSettings = selected.settingsSnapshot;
    i18n.systemLocale = selected.systemLocale;
    if (selected.slidev) {
      clearRenderDiagnostics();
      await i18n.setLocale(await settings.get('preferredLocale'));
      const { slides, configs, themeUrl, issues } = await prepareSlides(selected);
      if (issues) throw Error(ui('演示文稿有 {0} 处资源不可用，无法导出', issues));
      return { slidev: { slides, configs, themeUrl } };
    }
    await snapshotDom(selected);
    if (selected.format === 'assets') {
      exportAssets = await inspectDocumentAssets(document.getElementById('markdown-content')!);
      return { assets: exportAssets.map(asset => asset.entry) };
    }
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('#markdown-content img')).map(async image => {
      try {
        await image.decode();
        if (!image.naturalWidth) throw new Error('Export image did not load');
      } catch (error) {
        if (selected.format === 'html' || selected.format === 'png') throw Error(ui('图片无法加载：{0}', image.alt || ui('未命名图片')));
        throw error;
      }
    }));
    if (getRenderDiagnostics().length) throw new Error(`Render diagnostics: ${JSON.stringify(getRenderDiagnostics())}`);
    if (selected.format === 'png') return { png: await layoutDocumentPng() };
    if (selected.format === 'html') {
      const container = document.getElementById('markdown-page')!;
      const title = container.querySelector('#markdown-content h1')?.textContent?.trim() || selected.filename;
      const result = await exportToHtml({ container, filename: selected.filename, title, offline: { embedImage: embedHtmlImage } });
      if (!result.success || !result.html) throw Error(result.error || 'HTML export failed');
      if (new TextEncoder().encode(result.html).length > 48 * 1024 * 1024) throw Error(ui('HTML 导出超过 48 MiB，请减少图片或图表后重试'));
      return { html: result.html };
    }
    if (selected.format === 'pdf') {
      const style = document.createElement('style');
      style.textContent = buildPrintCss(document.getElementById('markdown-page')!, selected.pdfPageCss);
      document.head.append(style);
      return {};
    }
    const result = await viewer.renderDocx(selected);
    if (getRenderDiagnostics().length) throw new Error(`Export diagnostics: ${JSON.stringify(getRenderDiagnostics())}`);
    return result;
  },
};
window.desktopViewer = viewer;
if (channel) {
  (document.getElementById('reader') || window).addEventListener('scroll', () => {
    if (restoring || !input) return;
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => { void viewer.saveReadingState().catch(error => console.error('Reading state save failed', error)); }, 150);
  }, { passive: true });
}
