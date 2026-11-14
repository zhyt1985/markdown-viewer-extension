import { isProbablyReaderable, Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
// @ts-ignore – no bundled typings for turndown-plugin-gfm
import { gfm } from 'turndown-plugin-gfm';

export function extractHtmlArticle(document: Document): { content: string; title: string } {
  const clone = document.cloneNode(true) as Document;
  let title = document.title;
  try {
    if (isProbablyReaderable(clone)) {
      const article = new Readability(clone).parse();
      if (article?.content) return { content: article.content, title: article.title || title };
      if (article?.title) title = article.title;
    }
  } catch (error) {
    console.warn('[mv:html2md] Readability failed:', error);
  }
  const main = clone.querySelector('main') || clone.querySelector('[role="main"]')
    || clone.querySelector('#main-content') || clone.querySelector('#main')
    || clone.querySelector('#content') || clone.querySelector('.content') || clone.body;
  return { content: main.innerHTML, title };
}

export function htmlArticleToMarkdown(content: string | HTMLElement, keepEmbeddedImages = false): string {
  const converter = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  converter.use(gfm);
  converter.remove(['script', 'style', 'noscript', 'svg' as keyof HTMLElementTagNameMap, 'iframe', 'canvas', 'form', 'button', 'dialog']);
  if (!keepEmbeddedImages) {
    converter.addRule('ignoreBase64Images', {
      filter: node => node.nodeName === 'IMG' && (node.getAttribute('src') || '').startsWith('data:image'),
      replacement: () => '',
    });
  }
  return converter.turndown(content);
}
