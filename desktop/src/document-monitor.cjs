const fs = require('node:fs/promises');
const { within } = require('./resource-policy.cjs');
const { stamp } = require('./document-files.cjs');

function createDocumentMonitor(onChange, interval = 750) {
  const records = new Map(); let busy = false, disposed = false;
  async function poll() {
    if (busy || disposed) return;
    busy = true;
    try {
      for (const [id, record] of records) {
        let signature, error;
        try {
          await within(record.root, record.source);
          signature = stamp(await fs.stat(record.source, { bigint: true }));
        } catch (failure) { signature = `error:${failure.code || failure.message}`; error = failure.message; }
        if (disposed) return;
        if (records.get(id) !== record || signature === record.signature) continue;
        record.signature = signature;
        onChange({ documentId: id, error: error || null });
      }
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void poll().catch(error => console.error('File monitor failed', error)); }, interval);
  timer.unref();
  return {
    watch(document) { records.set(document.documentId, { root: document.resourceRoot, source: document.source, signature: document.diskStamp }); },
    unwatch(id) { records.delete(id); },
    poll,
    dispose() { disposed = true; clearInterval(timer); records.clear(); },
  };
}
module.exports = { createDocumentMonitor };
