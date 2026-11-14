import { extractHtmlArticle, htmlArticleToMarkdown } from '../../src/core/html-to-markdown';
import { sanitizeHtmlTree } from '../../src/utils/html-sanitizer';
import { ui } from './desktop-ui';

const maxMarkdownBytes = 10 * 1024 * 1024;
const imageData = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)(?:;[^,]*)?,/i;

async function portableImage(url: string): Promise<string | null> {
  if (!imageData.test(url) || url.length > maxMarkdownBytes) return null;
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { return null; }
  if (/^data:image\/(?:png|jpeg|gif);base64,/i.test(url)) return url;
  // Convert other image types to PNG so they remain usable in Word and PDF.
  const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/png');
    return imageData.test(encoded) ? encoded : null;
  } catch { return null; }
}

export async function convertLocalHtml(html: string, readImage?: (source: string) => Promise<string | null>) {
  const detached = document.implementation.createHTMLDocument('');
  const source = detached.createElement('template');
  source.innerHTML = html;
  detached.title = source.content.querySelector('title')?.textContent || '';
  // Template contents are inert, including resources from pasted markup.
  source.content.querySelectorAll('title, style, svg').forEach(node => node.remove());
  sanitizeHtmlTree(source.content);
  detached.body.replaceChildren(source.content);
  const article = extractHtmlArticle(detached);
  const content = detached.createElement('template');
  content.innerHTML = article.content;
  const container = detached.createElement('div');
  container.append(content.content);
  // GFM can keep a complex table as HTML. Retain only formatting attributes and
  // the URLs we handle below, so that even those tables stay self-contained.
  const attributes = new Set(['href', 'src', 'alt', 'title', 'align', 'colspan', 'rowspan', 'start', 'class', 'type', 'checked']);
  for (const element of container.querySelectorAll('*')) {
    for (const attr of Array.from(element.attributes)) {
      if (!attributes.has(attr.name) || (attr.name === 'src' && element.tagName !== 'IMG') ||
          (attr.name === 'href' && element.tagName !== 'A')) element.removeAttribute(attr.name);
    }
  }
  if (article.title && !container.querySelector('h1')) {
    const heading = detached.createElement('h1');
    heading.textContent = article.title;
    container.prepend(heading);
  }
  for (const anchor of container.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')!.trim();
    if (/^\s*(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(href) && !/^(?:https?:|mailto:)/i.test(href)) {
      anchor.removeAttribute('href');
    }
  }

  const resolved = new Map<string, string | null>();
  let omitted = 0;
  let budget = maxMarkdownBytes - new TextEncoder().encode(htmlArticleToMarkdown(container)).length;
  for (const image of container.querySelectorAll('img')) {
    const src = image.getAttribute('src')?.trim() || '';
    if (src && budget > 0 && !resolved.has(src)) {
      const data = imageData.test(src) ? src : await readImage?.(src);
      const encoded = data ? await portableImage(data) : null;
      resolved.set(src, encoded && encoded.length <= budget ? encoded : null);
    }
    const encoded = resolved.get(src);
    if (encoded && encoded.length <= budget) {
      image.setAttribute('src', encoded);
      budget -= encoded.length;
    } else {
      const alt = image.getAttribute('alt')?.trim() || ui('未命名图片');
      image.replaceWith(detached.createTextNode(ui('图片未导入：{0}', alt)));
      omitted++;
    }
  }
  const markdown = htmlArticleToMarkdown(container, true);
  if (!markdown.trim()) throw Error(ui('HTML 中没有可转换的正文'));
  return { markdown, omitted };
}
