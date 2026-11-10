import type { PlatformAPI, DocumentService } from '../../src/types/platform';
import type { RendererThemeConfig } from '../../src/types/render';
import { SettingsService } from '../../src/services/settings-service';
import { renderMarkdownDocument, resetDocument } from '../../src/core/viewer/viewer-controller';
import type { RenderResult } from '../../src/types/render';
import { loadAndApplyTheme } from '../../src/utils/theme-to-css';
import { buildPrintCss } from '../../src/ui/print-utils';
import { clearRenderDiagnostics, getRenderDiagnostics } from '../../src/core/render-diagnostics';
import { clearDiagramExports, getDiagramExport } from '../../src/ui/diagram-export-registry';
import DocxExporter from '../../src/exporters/docx-exporter';
import { ServiceChannel } from '../../src/messaging/channels/service-channel';
import { StorageService } from '../../src/services/storage-service';
import { CacheService } from '../../src/services/cache-service';
import { FileStateService } from '../../src/services/file-state-service';
import { ElectronTransport } from './electron-transport';
import { DesktopI18n } from './i18n';
import { AsyncTaskManager } from '../../src/core/markdown-processor';
import {summaryTree} from './book-tree';
import {readingFontCSS,type ReadingFontPreferences} from './reading-fonts';
import {setupDiagramPreview} from './diagram-preview';
import type { SettingKey, SettingTypes, SetSettingOptions } from '../../src/types/settings';

interface DocumentInput {
  markdown: string; filename: string; documentPath: string; documentDir: string;
  documentBaseUrl: string; fileReadUrl: string; resourceBaseUrl: string;
  documentId: string; documentVersion: string;
  untitled?: boolean;
}
interface DesktopBridge {
  preferences(operation:'get'):Promise<{readingFont:ReadingFontPreferences}>;
  state(operation: 'get' | 'set' | 'remove', payload: unknown): Promise<Record<string, unknown>>;
  render(payload: { renderType: string; input: string | object; themeConfig: RendererThemeConfig | null; documentId: string; documentVersion: string }): Promise<RenderResult>;
  service(envelope: unknown): Promise<unknown>;
  onService(handler: (message: unknown) => void): () => void;
}
declare global {
  interface Window {
    desktop: DesktopBridge;
    desktopViewer: typeof viewer;
  }
}

let input: DocumentInput;
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
let previewTasks: AsyncTaskManager | null = null;
let sourceEntries: {element:HTMLElement;start:number;count:number}[] = [];
let diagramPreview:ReturnType<typeof setupDiagramPreview>|null=null;
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
}
const settings = new DesktopSettings({ storage });
const resourceUrl = (value: string) => {
  if(input?.untitled)throw Error('未命名文档尚无资源目录，请先保存后引用本机文件');
  if (/^(?:file:|[a-zA-Z]:[\\/]|\/)/.test(value)) {
    const url = new URL(input.fileReadUrl);
    url.searchParams.set('path', value);
    return url.href;
  }
  const url = new URL(value.replace(/\\/g, '/'), `${input.documentBaseUrl}/`);
  if (url.protocol !== 'documd:' || url.host !== 'viewer') throw new Error('Only local document resources are supported');
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

function indexSource(container:HTMLElement) {
  sourceEntries = Array.from(container.querySelectorAll<HTMLElement>('.md-block[data-line]'),element=>({
    element,start:Number(element.dataset.line),count:Number(element.dataset.lineCount||1),
  }));
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
  const tasks = new AsyncTaskManager((key, substitutions) => i18n.translate(key, substitutions) || key);
  previewTasks = tasks;
  const check = () => { if (tasks.isAborted()) throw new Error('Preview superseded'); };
  restoring = true;
  input = selected;
  hasDocument = true;
  resetDocument(); clearRenderDiagnostics(); clearDiagramExports(); theme = null;
  const container = document.getElementById('markdown-content')!;
  diagramPreview?.close();
  sourceEntries = [];
  container.replaceChildren();
  clearDisplayImages();
  for (const prefix of ['table-layout-', 'image-layout-', 'diagram-layout-']) {
    for (const name of Array.from(container.classList)) if (name.startsWith(prefix)) container.classList.remove(name);
  }
  container.classList.add(`table-layout-${await settings.get('tableLayout')}`,
    `image-layout-${await settings.get('imageLayout')}`, `diagram-layout-${await settings.get('diagramLayout')}`);
  await loadAndApplyTheme(await settings.get('themeId'));
  await i18n.setLocale(await settings.get('preferredLocale'));
  check();
  const result = await renderMarkdownDocument({
    markdown: selected.markdown, container, renderer: platform.renderer, translate: (key, substitutions) => i18n.translate(key, substitutions) || key,
    frontmatterDisplay: await settings.get('frontmatterDisplay'),
    tableMergeEmpty: await settings.get('tableMergeEmpty'), tableLayout: await settings.get('tableLayout'),
    taskManager: tasks,
    // Keep source positioning available while later diagrams are still rendering.
    onChunkComplete:()=>{if(!tasks.isAborted())indexSource(container);},
    onStreamingComplete:()=>{if(!tasks.isAborted())indexSource(container);},
  });
  check();
  await result.taskManager.processAll();
  check();
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
      scroll.setAttribute('aria-label', '表格');
      table.before(scroll);
      scroll.append(table);
    }
  }
  await document.fonts.ready;
  check();
  if(location.hostname==='viewer')await sizeDisplayDiagrams(container,check);
  check();
  diagramPreview?.decorate();
  indexSource(container);
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
const viewer = {
  configureReadingFont,
  previewReadingFont:(font:ReadingFontPreferences)=>fontStyle('desktop-reading-sample',readingFontCSS(font,'#reader-font-sample','DocumdSample')),
  originalImageSource:(image:HTMLImageElement)=>displayOriginals.get(image)||image.src,
  summaryTree,
  snapshotDom,
  cancelPreview(){previewTasks?.abort();},
  sourceLine:previewLine,
  revealLine,
  finishPreview(line:number|null,top:number){
    const reader=document.getElementById('reader');
    if(line!==null)revealLine(line);else reader?.scrollTo({top,behavior:'instant'});
    restoring=false;
  },
  clear() {
    diagramPreview?.close();
    sourceEntries = [];
    clearTimeout(readingTimer); restoring = true; hasDocument = false;
    resetDocument(); clearRenderDiagnostics(); clearDiagramExports();
    document.getElementById('markdown-content')!.replaceChildren();
    clearDisplayImages();
  },
  async init() {
    await i18n.setLocale(await settings.get('preferredLocale'));
    if(channel){
      await configureReadingFont((await window.desktop.preferences('get')).readingFont);
      diagramPreview=setupDiagramPreview(document.getElementById('markdown-content')!,image=>{
        const hash=image.dataset.sourceHash||image.closest<HTMLElement>('.diagram-block')?.dataset.sourceHash;
        const svg=hash?getDiagramExport(hash)?.svg:undefined;
        return {source:svg||displayOriginals.get(image)||image.src,vector:Boolean(svg)};
      });
    }
  },
  async saveReadingState() {
    clearTimeout(readingTimer);
    if (!channel || !input || restoring) return;
    await channel.send('FILE_STATE_OPERATION', { operation: 'set', url: input.documentId, state: { scrollTop: document.getElementById('reader')?.scrollTop ?? window.scrollY } });
  },
  async restoreReadingState() {
    if (!channel || !input) return;
    const state = await platform.fileState.get(input.documentId);
    const target = document.getElementById('reader') || window;
    target.scrollTo({ top: typeof state.scrollTop === 'number' ? state.scrollTop : 0, behavior: 'instant' });
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
    const result = await new DocxExporter(platform.renderer).exportToDocx(selected.markdown, selected.filename);
    if (!result.success) throw new Error(result.error || 'DOCX export failed');
    const blob = download as Blob | null;
    if (!blob) throw new Error('DOCX exporter did not produce a file');
    return { base64: base64(new Uint8Array(await blob.arrayBuffer())) };
  },
  async exportDocument(selected: DocumentInput & { format: 'docx' | 'pdf'; settingsSnapshot: Record<string, unknown> }) {
    if (location.hostname !== 'export') throw new Error('Exports require the isolated export host');
    exportSettings = selected.settingsSnapshot;
    await snapshotDom(selected);
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('#markdown-content img')).map(async image => {
      await image.decode();
      if (!image.naturalWidth) throw new Error('Export image did not load');
    }));
    if (getRenderDiagnostics().length) throw new Error(`Render diagnostics: ${JSON.stringify(getRenderDiagnostics())}`);
    if (selected.format === 'pdf') {
      const style = document.createElement('style');
      style.textContent = buildPrintCss(document.getElementById('markdown-page')!);
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
