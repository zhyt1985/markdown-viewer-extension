import mermaid from 'mermaid';
import { dsvFormat } from 'd3-dsv';
import { handleRender, initRenderEnvironment, type RenderRequest } from '../../src/renderers/render-worker-core';
import { DirectResourceService } from '../../src/services/resource-service';

window.mermaid = mermaid;
type IconPack = Awaited<ReturnType<Extract<Parameters<typeof mermaid.registerIconPacks>[0][number], { loader: unknown }>['loader']>>;
let fontAwesome: Promise<Record<'fas' | 'far' | 'fab', IconPack>> | undefined;
function loadFontAwesome() {
  return fontAwesome ??= fetch('documd://render/assets/mermaid-fontawesome.json').then(response => {
    if (!response.ok) throw Error('Bundled Mermaid icon packs are unavailable');
    return response.json();
  }).catch(error => { fontAwesome = undefined; throw error; });
}
mermaid.registerIconPacks([
  ...(['fas', 'far', 'fab'] as const).map(name => ({ name, loader: async () => (await loadFontAwesome())[name] })),
  { name: 'fa', loader: async (): Promise<IconPack> => {
    const { fas, fab } = await loadFontAwesome();
    // The unqualified legacy prefix uses solid icons plus brands. Materialize
    // each pack's default dimensions before combining the two collections.
    const withDimensions = (pack: IconPack) => Object.fromEntries(Object.entries(pack.icons).map(([name, icon]) =>
      [name, { width: pack.width, height: pack.height, ...icon }]));
    const icons = { ...withDimensions(fab), ...withDimensions(fas) };
    const aliases: NonNullable<IconPack['aliases']> = { ...fab.aliases, ...fas.aliases };
    for (const name of Object.keys(aliases)) if (Object.prototype.hasOwnProperty.call(icons, name)) delete aliases[name];
    return { prefix: 'fa', icons, aliases };
  } },
]);
// Render engines need bundled fonts/stencils, not file or application access.
globalThis.platform = {
  resource: new DirectResourceService(path => new URL(path, 'documd://render/assets/').href),
} as unknown as typeof globalThis.platform;
initRenderEnvironment();
declare global { interface Window { renderHost: typeof handleRender; } }

// d3-dsv's object parser generates a function at runtime. Use its row parser
// and map headers ourselves, keeping JavaScript evaluation disabled in the host.
function normalizeDelimitedData(input: object) {
  const pending = [input];
  while (pending.length) {
    const node = pending.pop() as Record<string, unknown>;
    if (node.data && typeof node.data === 'object') {
      for (const data of Array.isArray(node.data) ? node.data : [node.data]) {
        if (typeof data?.values !== 'string') continue;
        const { type, delimiter, header, ...format } = data.format || {};
        if (type !== 'csv' && type !== 'tsv' && type !== 'dsv') continue;
        const separator = type === 'csv' ? ',' : type === 'tsv' ? '\t' : delimiter;
        if (typeof separator !== 'string' || separator.length !== 1) throw Error('Invalid Vega data delimiter');
        const rows = dsvFormat(separator).parseRows(data.values);
        const columns = Array.isArray(header) ? header.map(String) : rows.shift() || [];
        if (columns.length * Math.max(1, rows.length) > 250000) throw Error('Vega delimited data exceeds 250,000 cells');
        data.values = rows.map(row => Object.fromEntries(columns.map((column: string, index: number) => [column, row[index] ?? ''])));
        data.format = { ...format, type: 'json' };
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'values' && value && typeof value === 'object') pending.push(value);
    }
  }
}
window.renderHost = (request: RenderRequest) => {
  if ((request.renderType === 'vega' || request.renderType === 'vega-lite') && typeof request.input === 'object') {
    normalizeDelimitedData(request.input);
  }
  return handleRender(request);
};
