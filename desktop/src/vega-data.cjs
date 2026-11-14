const path = require('node:path');
const fs = require('node:fs/promises');
const { resourcePath, resolveResource, validateResource } = require('./resource-policy.cjs');
const { readDocumentBytes } = require('./document-files.cjs');

const formatByExtension = { '.json': 'json', '.csv': 'csv', '.tsv': 'tsv', '.topojson': 'topojson' };
const maxBytes = 4 * 1024 * 1024;

// Resolve only declarative data URLs. The render process receives the bytes
// required for this job and has no need for a filesystem grant.
async function embedVegaData(input, document) {
  let spec;
  try { spec = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { return input; } // Let the engine provide its usual parse diagnostic.
  if (!spec || typeof spec !== 'object') return input;
  const files = new Map();
  let total = 0;
  const pending = [spec];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.data && typeof node.data === 'object') {
      for (const entry of Array.isArray(node.data) ? node.data : [node.data]) {
        if (typeof entry?.url !== 'string') continue;
        const url = entry.url.trim();
        if (/^data:/i.test(url)) continue;
        if (!document?.source || !url || url.length > 32768 || /^(?:[a-z][a-z\d+.-]*:|[\\/#?])/i.test(url) || /[\u0000-\u001f]/.test(url)) {
          throw Error(`Vega data requires a relative file within the authorized directory: ${url.slice(0, 200)}`);
        }
        let file = files.get(url);
        if (!file) {
          let target, bytes;
          try {
            const scope = await resolveResource(document, resourcePath(document, url), 'chart');
            target = scope.target;
            const stat = await fs.stat(target);
            if (!stat.isFile() || stat.size > maxBytes) throw Error('Expected a small data file');
            ({ bytes } = await readDocumentBytes(scope.root, target));
            await validateResource(scope);
          } catch { throw Error(`Vega data file is unavailable within the authorized directory: ${url.slice(0, 200)}`); }
          const type = formatByExtension[path.extname(target).toLowerCase()] || 'json';
          let content;
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch { throw Error(`Vega data file must be UTF-8: ${url.slice(0, 200)}`); }
          file = { type, content, size: Buffer.byteLength(JSON.stringify(content)) };
          files.set(url, file);
        }
        total += file.size;
        if (total > maxBytes) throw Error('Vega data references exceed 4 MiB when embedded');
        // Vega parses inline values with the original format. Doing this as
        // inline data avoids an async fetch failure being logged as a blank chart.
        delete entry.url;
        entry.values = file.content;
        entry.format = { type: file.type, ...entry.format };
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'values' && value && typeof value === 'object') pending.push(value);
    }
  }
  return spec;
}

module.exports = { embedVegaData };
