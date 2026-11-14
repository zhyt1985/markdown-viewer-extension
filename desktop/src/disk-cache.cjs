const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function createDiskCache(directory, namespace, { maxItems = 100, maxBytes = 64 * 1024 * 1024, maxEntryBytes = 8 * 1024 * 1024 } = {}) {
  let queue = Promise.resolve();
  let generation = 0;
  let clock = Date.now();
  const tick = () => (clock = Math.max(clock + 1, Date.now()));
  const name = key => `${createHash('sha256').update(namespace + '\0' + key).digest('hex')}.json`;
  async function entries() {
    await fs.mkdir(directory, { recursive: true });
    const result = [];
    for (const file of await fs.readdir(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const target = path.join(directory, file);
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.size > maxEntryBytes + 65536) throw Error('Invalid cache file');
        const entry = JSON.parse(await fs.readFile(target, 'utf8'));
        if (entry.namespace !== namespace || typeof entry.key !== 'string' || name(entry.key) !== file
            || !Number.isFinite(entry.accessTime) || !Number.isFinite(entry.timestamp)) throw Error('Invalid cache record');
        entry.size = stat.size;
        clock = Math.max(clock, entry.accessTime);
        result.push(entry);
      } catch { await fs.unlink(target).catch(() => {}); }
    }
    return result;
  }
  async function evict(records) {
    records.sort((a, b) => a.accessTime - b.accessTime);
    let bytes = records.reduce((sum, entry) => sum + entry.size, 0);
    while (records.length > maxItems || bytes > maxBytes) {
      const entry = records.shift(); bytes -= entry.size;
      await fs.unlink(path.join(directory, name(entry.key))).catch(() => {});
    }
    return records;
  }
  function run(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  async function write(entry) {
    const target = path.join(directory, name(entry.key));
    const data = JSON.stringify(entry);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, target);
    entry.size = Buffer.byteLength(data);
  }
  return {
    get generation() { return generation; },
    get(key) { return run(async () => {
      const records = await evict(await entries());
      const entry = records.find(record => record.key === key);
      if (!entry) return null;
      entry.accessTime = tick(); await write(entry);
      return entry.value;
    }); },
    set(key, value, type = 'unknown', expectedGeneration) { return run(async () => {
      if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
      if (typeof key !== 'string' || key.length > 512) throw Error('Invalid cache key');
      const data = JSON.stringify(value);
      if (data === undefined || Buffer.byteLength(data) > maxEntryBytes) return false;
      const records = (await entries()).filter(record => record.key !== key);
      const entry = { namespace, key, value, type, timestamp: tick(), accessTime: tick() };
      await write(entry); records.push(entry); await evict(records);
      return records.includes(entry);
    }); },
    delete(key) { return run(async () => { await fs.unlink(path.join(directory, name(key))).catch(error => { if (error.code !== 'ENOENT') throw error; }); return true; }); },
    clear() {
      generation++;
      return run(async () => {
        for (const entry of await entries()) await fs.unlink(path.join(directory, name(entry.key)));
        return true;
      });
    },
    stats() { return run(async () => {
      const records = await evict(await entries());
      const totalSize = records.reduce((sum, entry) => sum + entry.size, 0);
      return { itemCount: records.length, maxItems, totalSize, totalSizeMB: (totalSize / 1048576).toFixed(2),
        items: records.map(({ namespace: _namespace, value: _value, ...metadata }) => metadata) };
    }); },
  };
}
module.exports = { createDiskCache };
