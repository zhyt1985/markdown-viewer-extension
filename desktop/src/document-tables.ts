import { collectTableRows, collectTableStyle, findHeadingBeforeTable, sanitizeFilenameBase } from '../../src/ui/table-context-menu';
import { buildXlsxBytes, flattenTableCells, tableDataToHtml, tableDataToTsv } from '../../src/utils/table-xlsx';
import { ui } from './desktop-ui';

const maxCells = 100_000;
const maxBytes = 12 * 1024 * 1024;

export function readTable(table: HTMLTableElement, container: HTMLElement, action: 'copy' | 'save', encode: (bytes: Uint8Array) => string) {
  if (table.rows.length > maxCells) throw Error(ui('表格超过 100,000 个单元格'));
  const rows = collectTableRows(table);
  let data;
  try { data = flattenTableCells(rows, maxCells); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw Error(ui('表格超过 100,000 个单元格'));
  }
  if (!data.rowCount || !data.colCount) throw Error(ui('表格没有可导出的单元格'));
  const style = collectTableStyle(table);
  if (action === 'copy') {
    // Keep formulas authored as Markdown text inert when pasted into a spreadsheet.
    const safe = { ...data, rows: data.rows.map(row => row.map(cell =>
      !cell.isNumber && /^[=+@\-＝＋＠－]/u.test(cell.text) ? { ...cell, text: "'" + cell.text } : cell)) };
    const html = tableDataToHtml(safe, style);
    const text = tableDataToTsv(safe);
    const utf8 = new TextEncoder();
    if (utf8.encode(html).byteLength + utf8.encode(text).byteLength > maxBytes) throw Error(ui('表格导出超过 12 MiB'));
    return { action, html, text };
  }
  const bytes = buildXlsxBytes(data, style);
  if (bytes.byteLength > maxBytes) throw Error(ui('表格导出超过 12 MiB'));
  return { action, name: sanitizeFilenameBase(findHeadingBeforeTable(table, container)), base64: encode(bytes) };
}
