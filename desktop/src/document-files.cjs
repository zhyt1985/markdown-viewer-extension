const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { within } = require('./resource-policy.cjs');
const {decode,encode} = require('./text-codecs.cjs');
const MAX_BYTES = 10 * 1024 * 1024;
const version = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino].join(':');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function validatePath(root, source, missing = false) {
  const parent = await within(root, path.dirname(source));
  if (!samePath(parent, path.dirname(source))) throw Error('Source directory was replaced');
  try {
    const actual = await within(root, source);
    if (!samePath(actual, source) || (await fs.lstat(source)).isSymbolicLink()) throw Error('Source file was replaced by a link');
  } catch (error) { if (!missing || error.code !== 'ENOENT') throw error; }
}
async function readBytes(root, source) {
  await validatePath(root, source);
  const file = await fs.open(source, 'r');
  let bytes; let stat;
  try {
    stat = await file.stat({ bigint: true });
    if (!stat.isFile() || stat.size > BigInt(MAX_BYTES)) throw Error('Markdown files must be at most 10 MiB');
    const chunks = []; let size = 0;
    while (size <= MAX_BYTES) {
      const chunk = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); size += bytesRead;
    }
    if (size > MAX_BYTES) throw Error('Markdown files must be at most 10 MiB');
    bytes = Buffer.concat(chunks, size);
    if (stamp(stat) !== stamp(await file.stat({ bigint: true }))) throw Error('Document changed while reading; retry');
  } finally { await file.close(); }
  await validatePath(root, source);
  return {bytes,diskVersion:version(bytes),diskStamp:stamp(stat),mode:Number(stat.mode)};
}
async function readDocument(root,source,encoding='auto') {
  const {bytes,...metadata}=await readBytes(root,source);return {...metadata,...decode(bytes,encoding)};
}
async function readDocumentVersion(root,source) {
  const {bytes,...metadata}=await readBytes(root,source);return metadata;
}
async function writeDocument({ root, source, markdown, format, expectedVersion }) {
  const bytes = encode(markdown, format);
  const temporary = path.join(path.dirname(source), `.${path.basename(source)}.${randomUUID()}.tmp`);
  async function check() {
    try {
      await validatePath(root, source, expectedVersion === null);
      const disk = await readDocumentVersion(root, source);
      if (disk.diskVersion !== expectedVersion) throw Error('SAVE_CONFLICT: 磁盘文件已变化；请重新载入或另存为');
      return disk.mode;
    } catch (error) {
      if (error.code === 'ENOENT' && expectedVersion === null) return 0o666;
      if (error.code === 'ENOENT') throw Error('SAVE_CONFLICT: 源文件已删除；请另存为');
      throw error;
    }
  }
  try {
    const mode = await check();
    const file = await fs.open(temporary, 'wx', mode);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await check();
    await fs.rename(temporary, source);
    return await readDocument(root, source,format.encoding||'utf-8');
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
module.exports = { readDocument, readDocumentVersion, writeDocument, encode, stamp };
