const fs = require('node:fs/promises');
const path = require('node:path');

// Single writer; acknowledge only after the atomic file replacement succeeds.
function createStateStore(directory) {
  const file = path.join(directory, 'desktop-state.json');
  let queue = Promise.resolve();
  async function read() {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.schemaVersion !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) {
        throw new Error('Unsupported or damaged desktop state');
      }
      return value.values;
    } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  return {
    async get(keys) {
      await queue;
      const values = await read();
      return Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
    },
    mutate(change) {
      const pending = queue.then(async () => {
        const values = await read();
        change(values);
        await fs.mkdir(directory, { recursive: true });
        const temporary = `${file}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, values }), 'utf8');
        await fs.rename(temporary, file);
      });
      queue = pending.catch(() => {});
      return pending;
    },
    update(operation, payload) {
      return this.mutate(values => {
        if (operation === 'set') Object.assign(values, payload);
        else for (const key of payload) delete values[key];
      });
    },
  };
}
module.exports = { createStateStore };
