import { getBlockRange, locateSubstringInNodes } from '../../src/ui/remark-utils';
import { CONTEXT_LENGTH, MAX_PARTS, MAX_QUOTE, type AnnotationPart, type AnnotationAnchor } from './annotation-data';

const blockSelector = '.md-block[data-line]';
const excluded = 'button,input,textarea,select,svg,script,style,[hidden],[aria-hidden="true"],.katex';
type TextBlock = { nodes: Text[]; text: string };
export type LocatedPart = { node: Text; start: number; end: number };

function blockText(block: HTMLElement): TextBlock {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return { nodes, text: nodes.map(node => node.data).join('') };
}

export function selectionAnchor(container: HTMLElement, range: Range, version: string) {
  if (range.collapsed || !container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const parts: AnnotationPart[] = [];
  let startLine = 0, endLine = 0, length = 0;
  for (const block of container.querySelectorAll<HTMLElement>(blockSelector)) {
    if (!range.intersectsNode(block)) continue;
    const { nodes, text } = blockText(block);
    let offset = 0, first = -1, last = -1;
    for (const node of nodes) {
      if (range.intersectsNode(node)) {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        if (end > start) {
          if (first < 0) first = offset + start;
          last = offset + end;
        }
      }
      offset += node.length;
    }
    if (first < 0) continue;
    const lines = getBlockRange(block);
    if (parts.length && lines.start <= parts[parts.length - 1].line) return null;
    if (!parts.length) startLine = lines.start;
    endLine = lines.end;
    length += last - first + 1;
    if (length > MAX_QUOTE || parts.length >= MAX_PARTS) return null;
    parts.push({
      line: lines.start, offset: first, text: text.slice(first, last),
      before: text.slice(Math.max(0, first - CONTEXT_LENGTH), first),
      after: text.slice(last, last + CONTEXT_LENGTH),
    });
  }
  const selectedText = parts.map(part => part.text).join('\n').trim();
  if (!selectedText) return null;
  return { startLine, endLine, selectedText, anchor: { version, parts } };
}

export function annotationBlocks(container: HTMLElement) {
  const blocks = new Map<number, HTMLElement[]>();
  for (const block of container.querySelectorAll<HTMLElement>(blockSelector)) {
    const line = getBlockRange(block).start;
    const sameLine = blocks.get(line);
    if (sameLine) sameLine.push(block);
    else blocks.set(line, [block]);
  }
  return blocks;
}

export function locateAnchor(blocks: ReturnType<typeof annotationBlocks>, anchor: AnnotationAnchor | undefined, version: string): LocatedPart[] | null {
  // A source revision or an imported quote alone is insufficient to choose a location.
  if (!anchor || anchor.version !== version) return null;
  const located: LocatedPart[] = [];
  for (const part of anchor.parts) {
    const end = part.offset + part.text.length;
    const matches = (blocks.get(part.line) || []).map(blockText).filter(({ text }) =>
      text.slice(part.offset, end) === part.text
      && text.slice(Math.max(0, part.offset - CONTEXT_LENGTH), part.offset) === part.before
      && text.slice(end, end + CONTEXT_LENGTH) === part.after);
    if (matches.length !== 1) return null;
    const { nodes } = matches[0];
    const offsets = locateSubstringInNodes(nodes.map(node => node.length), part.offset, part.text.length);
    if (!offsets) return null;
    for (let i = offsets.start.nodeIndex; i <= offsets.end.nodeIndex; i++) {
      const node = nodes[i];
      const start = i === offsets.start.nodeIndex ? offsets.start.localOffset : 0;
      const end = i === offsets.end.nodeIndex ? offsets.end.localOffset : node.length;
      if (start < end) located.push({ node, start, end });
    }
  }
  return located.length ? located : null;
}
