/**
 * HTML to Markdown Converter Content Script
 *
 * This script is injected into HTML pages when the user triggers
 * "View as Markdown" via the context menu. It extracts the readable
 * article content using Readability, converts it to Markdown using
 * Turndown, and stores the result on window so the viewer can consume it.
 */

import { extractHtmlArticle, htmlArticleToMarkdown } from '../../../src/core/html-to-markdown';

export interface HtmlConvertedMarkdown {
  markdown: string;
  title: string;
  /** Original page URL */
  url: string;
}

declare global {
  interface Window {
    __mvHtmlConvertedMarkdown?: HtmlConvertedMarkdown;
    __markdownViewerInjected?: boolean;
  }
}

function convertHtmlPageToMarkdown(): HtmlConvertedMarkdown | null {
  // Self-detect: only convert if the page is a rendered HTML document.
  // For raw files (text/plain, application/octet-stream, etc.) the viewer
  // can render them directly from document.body.textContent.
  const contentType: string =
    (document as unknown as { contentType?: string }).contentType || '';

  if (contentType && !contentType.includes('text/html')) {
    return null;
  }

  // If contentType is empty (e.g. some file:// URLs) check whether the body
  // is just a single <pre> wrapper – a clear sign this is raw plain text.
  if (!contentType) {
    const kids = Array.from(document.body?.children ?? []);
    if (kids.length === 1 && kids[0].tagName === 'PRE') {
      return null;
    }
  }
  const { content, title } = extractHtmlArticle(document);
  let markdown = htmlArticleToMarkdown(content);

  // Clean up: lone dashes / middle-dots on their own line
  markdown = markdown.replace(/^[ \t]*[-·][ \t]*$/gm, '');
  // Collapse runs of blank lines to a single blank line
  markdown = markdown.replace(/^[ \t]+$/gm, '');
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  return {
    markdown,
    title,
    url: window.location.href,
  };
}

if (window.__markdownViewerInjected) {
  console.log('[html-to-markdown] Markdown Viewer already injected, skipping DOM convert.');
} else {
  // Run immediately when injected and expose the result on window.
  // Returns null for non-HTML pages so the viewer falls back to raw textContent.
  const result = convertHtmlPageToMarkdown();
  if (result) {
    window.__mvHtmlConvertedMarkdown = result;
  }
}
