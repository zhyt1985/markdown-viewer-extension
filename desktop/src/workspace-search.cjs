const fs = require('node:fs/promises');
const path = require('node:path');
const { within } = require('./resource-policy.cjs');

// Bounded literal search. Every directory/file is revalidated; links are skipped.
async function searchWorkspace(workspaces, id, query, mode, signal, limits = {}, onProgress = () => {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 256 || !['filename', 'content'].includes(mode)) throw Error('Invalid search query');
  const maxEntries = limits.entries ?? 20000, maxFiles = limits.files ?? 10000;
  const maxBytes = limits.bytes ?? 64 * 1024 * 1024, maxResults = limits.results ?? 200;
  const root = workspaces.describe(id).root;
  const needle = query.toLowerCase();
  const result = { items: [], entries: 0, files: 0, bytes: 0, skipped: 0, truncated: false, canceled: false };
  const directories = [{ source: root, depth: 0 }];
  const check = () => { if (signal.aborted) throw Error('SEARCH_CANCELED'); workspaces.describe(id); };
  let lastProgress = -Infinity;
  const report = () => {
    const now = performance.now();
    if (now - lastProgress < 100 || signal.aborted) return;
    lastProgress = now;
    onProgress({ entries: result.entries, files: result.files, matches: result.items.length });
  };
  try {
    while (directories.length) {
      check();
      const directory = directories.pop();
      let handle;
      try { handle = await fs.opendir(await within(root, directory.source)); }
      catch (error) { if (directory.source === root || signal.aborted) throw error; result.skipped++; continue; }
      try {
        check();
        for await (const entry of handle) {
          // Yield periodically even when most entries need no file I/O.
          if (result.entries % 32 === 0) { await new Promise(resolve => setImmediate(resolve)); check(); report(); }
          check();
          if (result.entries >= maxEntries) { result.truncated = true; break; }
          result.entries++;
          if (entry.isSymbolicLink()) { result.skipped++; continue; }
          const source = path.join(directory.source, entry.name);
          if (entry.isDirectory()) {
            if (directory.depth < 32) directories.push({ source, depth: directory.depth + 1 });
            else result.skipped++;
            continue;
          }
          if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
          if (result.files >= maxFiles) { result.truncated = true; break; }
          result.files++;
          try {
            const add = async (line, snippet) => {
              const entryId = await workspaces.registerFile(id, source);
              check();
              result.items.push({ entryId, name: path.relative(root, source), line, snippet });
            };
            if (mode === 'filename') {
              if (entry.name.toLowerCase().includes(needle)) await add(1, '');
            } else {
              const canonical = await within(root, source); check();
              const stat = await fs.stat(canonical);
              if (stat.size > 10 * 1024 * 1024) { result.skipped++; continue; }
              if (result.bytes + stat.size > maxBytes) { result.truncated = true; break; }
              const file = await fs.open(canonical, 'r');
              let buffer;
              try {
                const limit = Math.min(10 * 1024 * 1024, maxBytes - result.bytes);
                const chunks = []; let size = 0;
                while (size <= limit) {
                  check();
                  const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
                  const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
                  if (!bytesRead) break;
                  chunks.push(chunk.subarray(0, bytesRead)); size += bytesRead;
                }
                buffer = Buffer.concat(chunks, size);
              } finally { await file.close(); }
              if (buffer.length > 10 * 1024 * 1024) { result.skipped++; continue; }
              if (result.bytes + buffer.length > maxBytes) { result.truncated = true; break; }
              const text = buffer.toString('utf8');
              result.bytes += buffer.length; check();
              let cursor = 0;
              for (let index = 0; cursor <= text.length; index++) {
                if (index % 1000 === 0) { await new Promise(resolve => setImmediate(resolve)); check(); }
                const newline = text.indexOf('\n', cursor);
                const line = text.slice(cursor, newline < 0 ? text.length : newline).replace(/\r$/, '');
                const position = line.toLowerCase().indexOf(needle);
                if (position >= 0) {
                  await add(index + 1, line.slice(Math.max(0, position - 60), position + needle.length + 120));
                  if (result.items.length >= maxResults) break;
                }
                if (newline < 0) break;
                cursor = newline + 1;
              }
            }
          } catch (error) { if (signal.aborted || error.message === 'Workspace is closed or unavailable') throw error; result.skipped++; }
          if (result.items.length >= maxResults) { result.truncated = true; break; }
        }
      } finally { await handle.close().catch(() => {}); }
      if (result.truncated) break;
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    result.canceled = true; result.items = [];
  }
  if (signal.aborted) { result.canceled = true; result.items = []; } else workspaces.describe(id);
  return result;
}
module.exports = { searchWorkspace };
