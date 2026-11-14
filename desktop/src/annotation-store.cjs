const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { within } = require('./resource-policy.cjs');
const { ANNOTATION_BYTES, validAnnotationRecord, mergeDesktopAnnotations } = require('./annotation-data.cjs');

async function readAnnotationText(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > ANNOTATION_BYTES) throw Error('批注文件必须小于 2 MiB');
    const buffer = Buffer.alloc(ANNOTATION_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > ANNOTATION_BYTES) throw Error('批注文件必须小于 2 MiB');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}

async function writeAnnotationText(file, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > ANNOTATION_BYTES) throw Error('批注文件超过 2 MiB');
  const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function createAnnotationStore(directory) {
  const root = path.resolve(directory);
  let queue = Promise.resolve();
  function filename(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid annotation document');
    return path.join(root, `${id}.json`);
  }
  function serialize(action) {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  }
  async function read(id) {
    const file = filename(id);
    try {
      await within(root, file);
      if (!(await fs.lstat(file)).isFile()) throw Error('Invalid annotation file');
      const record = JSON.parse(await readAnnotationText(file));
      if (!validAnnotationRecord(record)) throw Error('批注记录损坏或版本不受支持');
      return record;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 1, revision: 0, annotations: [] };
    }
  }
  async function write(id, revision, annotations) {
    const record = { version: 1, revision, annotations };
    if (!validAnnotationRecord(record)) throw Error('批注格式不正确或数量超过上限');
    await fs.mkdir(root, { recursive: true });
    await within(root, root);
    await writeAnnotationText(filename(id), JSON.stringify(record));
    return record;
  }
  async function remove(id) {
    const file = filename(id);
    try { await within(root, root); await fs.rm(file, { force: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {
    async get(id) { await queue; return read(id); },
    set(id, revision, annotations) {
      return serialize(async () => {
        const previous = await read(id);
        if (previous.revision !== revision) throw Error('批注已更新，请重试');
        return write(id, revision + 1, annotations);
      });
    },
    transfer(from, to, move) {
      return serialize(async () => {
        const source = await read(from);
        if (!source.annotations.length) return;
        const target = await read(to);
        const { merged } = mergeDesktopAnnotations(target.annotations, source.annotations, randomUUID);
        await write(to, target.revision + 1, merged);
        if (move) await remove(from);
      });
    },
    remove(ids) { return serialize(async () => { for (const id of ids) await remove(id); }); },
    flush() { return queue; },
  };
}
module.exports = { createAnnotationStore, readAnnotationText, writeAnnotationText };
