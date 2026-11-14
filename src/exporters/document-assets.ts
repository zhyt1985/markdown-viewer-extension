import type { RenderDiagnostic } from '../core/render-diagnostics';
import { getDiagramExport } from '../ui/diagram-export-registry';

export interface DocumentAsset {
  index: number;
  kind: 'diagram' | 'image';
  type: string;
  line: number | null;
  blockId: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  error?: string;
}

function sourceLineOf(element: HTMLElement): number | null {
  const line = Number(element.dataset.sourceLine);
  return Number.isFinite(line) && line > 0 ? line : null;
}

export function documentAssets(content: HTMLElement, diagnostics: RenderDiagnostic[], kinds = new Set(['image', 'diagram'])) {
  const reasons = new Map(diagnostics.filter(d => d.level === 'error' && d.blockId && d.message).map(d => [d.blockId, d.message]));
  const assets = [] as { meta: DocumentAsset; image: HTMLImageElement | null; vector: ReturnType<typeof getDiagramExport> }[];
  for (const node of content.querySelectorAll<HTMLElement>('.diagram-block, img, .mv-plugin-error, .async-placeholder')) {
    const plainImage = node instanceof HTMLImageElement;
    if (plainImage && node.closest('.diagram-block')) continue;
    const placeholder = node.classList.contains('async-placeholder');
    const error = node.classList.contains('mv-plugin-error');
    const diagram = placeholder || error || node.classList.contains('diagram-block') || node.dataset.pluginRendered === 'true';
    const kind = diagram ? 'diagram' : 'image';
    if (!kinds.has(kind)) continue;
    const image = plainImage ? node : node.querySelector('img');
    const blockId = diagram ? node.id || node.dataset.blockId || null : null;
    let line = sourceLineOf(node);
    // Plain image lines are relative to their independently parsed block.
    if (!diagram && line !== null) line += Number(node.closest('[data-line]')?.getAttribute('data-line')) || 0;
    const hash = node.dataset.sourceHash || image?.dataset.sourceHash;
    const meta: DocumentAsset = {
      index: assets.length + 1, kind, type: diagram ? node.dataset.pluginType || image?.dataset.pluginType || 'diagram' : 'image',
      line, blockId, alt: image?.alt || '', width: image?.naturalWidth || null, height: image?.naturalHeight || null,
    };
    if (placeholder) meta.error = 'the block was never rendered';
    else if (error) meta.error = reasons.get(blockId) || (node.textContent || '').trim().replace(/\s+/g, ' ') || 'the block failed to render';
    assets.push({ meta, image, vector: diagram && hash ? getDiagramExport(hash) : undefined });
  }
  return assets;
}
