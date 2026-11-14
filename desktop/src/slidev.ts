import { parseSlides } from '../../src/slidev/slidev-core';
import { recordRenderDiagnostic } from '../../src/core/render-diagnostics';
import { sanitizeHtmlTree } from '../../src/utils/html-sanitizer';
import type { RenderResult } from '../../src/types/render';
import { bindUi, ui } from './desktop-ui';

const origin = 'documd://slides';
const bundle = `${origin}/assets/slidev/`;
type Mode = 'presentation' | 'list';
type Deck = Awaited<ReturnType<typeof prepareSlideDeck>>;
type Theme = { file: string; fonts?: { sans?: string; serif?: string }; colorSchema?: 'light' | 'dark' | 'both' };
const assetLimit = 2 * 1024 * 1024;
const deckAssetLimit = 20 * 1024 * 1024;
const dataImage = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)(?:;[^,]*)?,/i;

async function boundedImage(response: Response) {
  const mime = response.headers.get('Content-Type')?.split(';')[0];
  if (!response.ok || !mime || !dataImage.test(`data:${mime},`) || !response.body) throw Error('Image unavailable');
  const reader = response.body.getReader();
  let size = 0;
  let binary = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > assetLimit) throw Error('Image too large');
      for (let i = 0; i < value.length; i += 0x8000) binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
    }
  } finally { void reader.cancel().catch(() => {}); }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function prepareSlideDeck(markdown: string, options: {
  readImage: (source: string, signal?: AbortSignal) => Promise<Response>;
  render: (type: string, source: string, theme: Theme) => Promise<RenderResult>;
  signal?: AbortSignal;
}) {
  if (!markdown.trim()) throw Error(ui('演示文稿没有内容'));
  const { signal } = options;
  const marker = `data-slidev-job-${crypto.randomUUID()}`;
  const { slides, configs, diagramJobs } = parseSlides(markdown, id => `<div ${marker}="${id}"></div>`);
  if (!slides.length || slides.length > 200) throw Error(ui('演示文稿须包含 1 至 200 张幻灯片'));
  const manifestResponse = await fetch(`${bundle}themes/themes.json`, { signal });
  if (!manifestResponse.ok) throw Error(ui('无法读取离线演示主题'));
  const manifest: Record<string, Theme> = await manifestResponse.json();
  const requestedTheme = configs.theme;
  const fallback = typeof requestedTheme !== 'string' || !Object.prototype.hasOwnProperty.call(manifest, requestedTheme);
  if (fallback) configs.theme = 'default';
  const theme = manifest[configs.theme];
  if (!/^theme-[a-z-]+\.js$/.test(theme?.file)) throw Error(ui('无法读取离线演示主题'));
  const themeUrl = `${bundle}themes/${theme.file}`;
  const jobs = new Map(diagramJobs.map(job => [String(job.id), job]));
  const assets = new Map<string, string | null>();
  let totalBytes = 0;
  let issues = 0;
  const report = (message: string) => {
    issues++;
    recordRenderDiagnostic({ type: 'slidev', kind: 'resource-failed', level: 'error', message });
  };
  const charge = (source: string) => {
    totalBytes += source.length;
    if (totalBytes > deckAssetLimit) throw Error(ui('演示文稿的图片与图表过大'));
    return source;
  };
  async function imageSource(source: string) {
    if (!assets.has(source)) {
      try {
        const embedded = dataImage.test(source) && source.length <= assetLimit * 4 / 3 + 100
          ? source : await boundedImage(await options.readImage(source, signal));
        const image = new Image(); image.src = embedded; await image.decode();
        assets.set(source, embedded);
      } catch (error) { signal?.throwIfAborted(); assets.set(source, null); }
    }
    const asset = assets.get(source);
    return asset ? charge(asset) : null;
  }

  for (const slide of slides) {
    signal?.throwIfAborted();
    // Keep the built-in layouts, appearance and click behavior; the shell never
    // receives arbitrary frontmatter props such as a source URL or components.
    const props = slide.frontmatter;
    slide.frontmatter = Object.fromEntries(['layout', 'class', 'transition', 'title', 'clicks', 'level', 'hideInToc', 'disabled'].flatMap(key =>
      ['string', 'number', 'boolean'].includes(typeof props[key]) ? [[key, props[key]]] : []));
    if (typeof props.background === 'string' && props.background.trim()) {
      const background = props.background.trim();
      if (CSS.supports('color', background)) slide.frontmatter.background = background;
      else {
        const src = await imageSource(background);
        if (src) slide.frontmatter.background = src;
        else report(ui('幻灯片 {0}：背景图片不可用', slide.no));
      }
    }
    if (typeof props.image === 'string' && props.image.trim() && ['image', 'image-left', 'image-right'].includes(props.layout)) {
      const src = await imageSource(props.image.trim());
      if (src) slide.frontmatter.image = src;
      else report(ui('幻灯片 {0}：图片不可用（{1}）', slide.no, props.image));
    }
    // Notes are not part of this reading/print view.
    slide.note = undefined;
    for (const [name, html] of Object.entries(slide.slots)) {
      const template = document.createElement('template');
      template.innerHTML = html;
      sanitizeHtmlTree(template.content);
      template.content.querySelectorAll('style, svg, math').forEach(node => node.remove());
      for (const element of template.content.querySelectorAll('a[href], [srcset]')) {
        element.removeAttribute('srcset');
        if (element.tagName === 'A') element.removeAttribute('href');
      }
      for (const image of template.content.querySelectorAll('img')) {
        const embedded = await imageSource(image.getAttribute('src')?.trim() || '');
        if (embedded) image.setAttribute('src', embedded);
        else {
          const message = ui('幻灯片 {0}：图片不可用（{1}）', slide.no, image.alt || ui('未命名图片'));
          report(message);
          image.replaceWith(document.createTextNode(message));
        }
      }
      for (const placeholder of template.content.querySelectorAll(`[${marker}]`)) {
        const job = jobs.get(placeholder.getAttribute(marker)!);
        if (!job) { placeholder.remove(); continue; }
        try {
          signal?.throwIfAborted();
          const result = await options.render(job.renderType, job.code, theme);
          signal?.throwIfAborted();
          if (!result.base64 || !result.width || !result.height) throw Error('Empty diagram');
          const image = document.createElement('img');
          image.src = charge(`data:image/png;base64,${result.base64}`);
          image.alt = job.renderType;
          image.width = Math.max(1, Math.round(result.width / 4));
          image.style.cssText = 'display:block;margin:auto;max-width:100%;height:auto';
          placeholder.replaceWith(image);
        } catch {
          signal?.throwIfAborted();
          const message = ui('幻灯片 {0}：{1} 图表无法渲染', slide.no, job.renderType);
          report(message);
          placeholder.replaceWith(document.createTextNode(message));
        }
      }
      slide.slots[name] = template.innerHTML;
    }
    slide.html = slide.slots.default || '';
  }
  const width = Number(configs.canvasWidth);
  configs.canvasWidth = Number.isFinite(width) && width >= 320 && width <= 1920 ? width : undefined;
  // Slidev's default ratio is used for invalid dimensions.
  if (typeof configs.aspectRatio !== 'number' && (typeof configs.aspectRatio !== 'string' || !/^\d+(?:\.\d+)?(?:[/:]\d+(?:\.\d+)?)?$/.test(configs.aspectRatio))) configs.aspectRatio = undefined;
  if (configs.aspectRatio !== undefined) {
    const [width, height = 1] = String(configs.aspectRatio).split(/[/:]/).map(Number);
    if (width / height < 0.4 || width / height > 4 || !Number.isFinite(width / height)) configs.aspectRatio = undefined;
  }
  return { slides, configs, themeUrl, issues, fallback };
}

export function showSlideDeck(container: HTMLElement, deck: Deck, signal: AbortSignal, native: {
  set(active: boolean): Promise<void>;
  onChange(callback: (active: boolean) => void): () => void;
}) {
  let mode: Mode = 'presentation';
  let page = 1;
  let frame: HTMLIFrameElement | undefined;
  const region = container.querySelector<HTMLElement>('#slidev-frame-region')!;
  const presentation = container.querySelector<HTMLButtonElement>('#slidev-presentation')!;
  const list = container.querySelector<HTMLButtonElement>('#slidev-list')!;
  const previous = container.querySelector<HTMLButtonElement>('#slidev-prev')!;
  const next = container.querySelector<HTMLButtonElement>('#slidev-next')!;
  const count = container.querySelector<HTMLElement>('#slidev-count')!;
  const full = container.querySelector<HTMLButtonElement>('#slidev-fullscreen')!;
  let ready = false;
  let fullPending = false;
  function controls() {
    presentation.setAttribute('aria-pressed', String(mode === 'presentation'));
    list.setAttribute('aria-pressed', String(mode === 'list'));
    presentation.disabled = list.disabled = !ready;
    full.disabled = !ready || fullPending;
    previous.disabled = !ready || mode !== 'presentation' || page <= 1;
    next.disabled = !ready || mode !== 'presentation' || page >= deck.slides.length;
    count.textContent = mode === 'presentation' ? `${page} / ${deck.slides.length}` : ui('{0} 张幻灯片', deck.slides.length);
  }
  function mount(): Promise<void> {
    ready = false; controls();
    const iframe = document.createElement('iframe');
    frame = iframe;
    iframe.id = 'slidev-frame';
    iframe.sandbox.add('allow-scripts', 'allow-same-origin');
    iframe.title = ui('Slidev 演示');
    iframe.src = `${bundle}slidev-shell/index.html`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error(ui('演示视图加载超时'))), 15000);
      const abort = () => finish(signal.reason);
      function finish(error?: Error) {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        window.removeEventListener('message', receive);
        if (error) reject(error); else resolve();
      }
      function receive(event: MessageEvent) {
        if (event.origin !== origin || event.source !== iframe.contentWindow) return;
        if (event.data?.type === 'SLIDEV_SHELL_READY') {
          iframe.contentWindow?.postMessage({ type: 'SLIDEV_INIT', slides: deck.slides, configs: deck.configs, themeUrl: deck.themeUrl, mode, page }, origin);
        } else if (event.data?.type === 'SLIDEV_DESKTOP_MOUNTED') {
          ready = true; controls(); finish();
        } else if (event.data?.type === 'SLIDEV_DESKTOP_ERROR') finish(Error(ui('演示视图无法载入')));
      }
      window.addEventListener('message', receive);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      region.replaceChildren(iframe);
    });
  }
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'SLIDEV_DESKTOP_ESCAPE' && container.hasAttribute('data-fullscreen')) void setFullscreen(false);
    if (event.data?.type === 'SLIDEV_DESKTOP_PAGE' && Number.isInteger(event.data.page) && event.data.page >= 1 && event.data.page <= deck.slides.length) {
      page = event.data.page; controls();
    }
  }, { signal });
  function modeButton(button: HTMLButtonElement, value: Mode) {
    button.addEventListener('click', () => {
      if (!ready || mode === value) return;
      mode = value;
      void mount().catch(error => { if (!signal.aborted) bindUi(count, '操作失败：{0}', error.message); });
    }, { signal });
  }
  modeButton(presentation, 'presentation'); modeButton(list, 'list');
  for (const [button, direction] of [[previous, -1], [next, 1]] as const) {
    button.addEventListener('click', () => frame?.contentWindow?.postMessage({ type: 'SLIDEV_DESKTOP_NAV', direction }, origin), { signal });
  }
  function fullState(active: boolean) {
    container.toggleAttribute('data-fullscreen', active);
    full.setAttribute('aria-pressed', String(active));
    bindUi(full, active ? '退出全屏' : '进入全屏');
  }
  async function setFullscreen(active: boolean) {
    if (fullPending) return;
    fullPending = true; controls();
    if (active) fullState(true);
    try { await native.set(active); if (!signal.aborted) fullState(active); }
    catch (error) { if (!signal.aborted) { fullState(false); bindUi(count, '操作失败：{0}', (error as Error).message); } }
    finally { fullPending = false; if (!signal.aborted) controls(); }
  }
  fullState(false);
  const unsubscribe = native.onChange(active => { if (!active) fullState(false); });
  full.addEventListener('click', () => { void setFullscreen(!container.hasAttribute('data-fullscreen')); }, { signal });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && container.hasAttribute('data-fullscreen')) void setFullscreen(false);
  }, { signal });
  signal.addEventListener('abort', () => {
    unsubscribe();
    if (container.hasAttribute('data-fullscreen')) { fullState(false); void native.set(false).catch(() => {}); }
    region.replaceChildren();
  }, { once: true });
  return mount();
}
