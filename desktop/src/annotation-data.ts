import type { HighlightStyle, RemarkAnnotation, RemarkColor } from '../../src/ui/remark-utils';

export { formatExportText, serializeAnnotations } from '../../src/ui/remark-utils';
export const ANNOTATION_BYTES = 2 * 1024 * 1024;
export const MAX_ANNOTATIONS = 400;
export const MAX_QUOTE = 16000;
export const MAX_NOTE = 4000;
export const MAX_PARTS = 64;
export const CONTEXT_LENGTH = 32;
export const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export const STYLES = ['background', 'underline', 'wavy', 'border'] as const;

export interface AnnotationPart {
  line: number;
  offset: number;
  text: string;
  before: string;
  after: string;
}
export interface AnnotationAnchor {
  version: string;
  parts: AnnotationPart[];
}
export interface DesktopAnnotation extends RemarkAnnotation {
  anchor?: AnnotationAnchor;
}
export interface AnnotationRecord {
  version: 1;
  revision: number;
  annotations: DesktopAnnotation[];
}
export interface AnnotationPreferences {
  color: RemarkColor;
  style: HighlightStyle;
  visible: boolean;
  closeAfterCopy: boolean;
}
export const ANNOTATION_DEFAULTS: AnnotationPreferences = {
  color: 'yellow', style: 'background', visible: true, closeAfterCopy: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}
function natural(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function validAnchor(value: unknown): value is AnnotationAnchor {
  if (!record(value) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
      || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > MAX_PARTS) return false;
  return value.parts.every((part, index, parts) => record(part) && natural(part.line) && natural(part.offset)
    && (index === 0 || part.line > parts[index - 1].line)
    && boundedText(part.text, MAX_QUOTE) && part.text.length > 0
    && boundedText(part.before, CONTEXT_LENGTH) && boundedText(part.after, CONTEXT_LENGTH));
}
export function mergeDesktopAnnotations(existing: DesktopAnnotation[], incoming: DesktopAnnotation[], makeId: () => string) {
  const quoteKey = (item: DesktopAnnotation) => JSON.stringify([item.startLine, item.endLine, item.selectedText]);
  const key = (item: DesktopAnnotation) => item.anchor
    ? JSON.stringify([item.anchor.version, item.anchor.parts.map(part => [part.line, part.offset, part.text])])
    : quoteKey(item);
  const merged = [...existing];
  const ids = new Set(existing.map(item => item.id));
  const positions = new Set(existing.map(key));
  const quotes = new Set(existing.map(quoteKey));
  let added = 0, skipped = 0;
  for (const item of incoming) {
    const position = key(item), quote = quoteKey(item);
    if (positions.has(position) || (!item.anchor && quotes.has(quote))) { skipped++; continue; }
    const id = ids.has(item.id) ? makeId() : item.id;
    merged.push({ ...item, id });
    ids.add(id);
    positions.add(position);
    quotes.add(quote);
    added++;
  }
  return { merged, added, skipped };
}
export function validAnnotation(value: unknown): value is DesktopAnnotation {
  return record(value)
    && typeof value.id === 'string' && /^[\w.-]{1,128}$/.test(value.id)
    && natural(value.startLine) && natural(value.endLine) && value.endLine >= value.startLine
    && boundedText(value.selectedText, MAX_QUOTE) && Boolean(value.selectedText.trim())
    && boundedText(value.note, MAX_NOTE) && COLORS.includes(value.color as RemarkColor)
    && natural(value.timestamp) && value.timestamp <= 8640000000000000
    && (value.blockId === undefined || boundedText(value.blockId, 128))
    && (value.anchor === undefined || (validAnchor(value.anchor)
      && value.anchor.parts.map(part => part.text).join('\n').trim() === value.selectedText.trim()));
}
export function validAnnotationRecord(value: unknown): value is AnnotationRecord {
  return record(value) && value.version === 1 && natural(value.revision)
    && Array.isArray(value.annotations) && value.annotations.length <= MAX_ANNOTATIONS
    && value.annotations.every(validAnnotation) && new Set(value.annotations.map(item => item.id)).size === value.annotations.length;
}
export function validAnnotationPreferences(value: unknown): value is AnnotationPreferences {
  return record(value) && Object.keys(value).length === 4
    && COLORS.includes(value.color as RemarkColor) && STYLES.includes(value.style as HighlightStyle)
    && typeof value.visible === 'boolean' && typeof value.closeAfterCopy === 'boolean';
}
