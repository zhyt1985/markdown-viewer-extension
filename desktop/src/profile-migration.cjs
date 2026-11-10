const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { within } = require('./resource-policy.cjs');

// Import only owned application state; leave the old profile and Chromium data intact.
// A same-directory staged inode is linked exclusively, never replacing new state.
async function migrateProfile(target, candidates) {
  await fs.mkdir(target, { recursive: true });
  const destination = path.join(target, 'desktop-state.json');
  try { await fs.lstat(destination); return { status: 'existing' }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const directory of candidates) {
    const source = path.join(directory, 'desktop-state.json');
    let temporary;
    try {
      await within(directory, source);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw Error('旧状态文件类型或大小无效');
      const bytes = await fs.readFile(source);
      const state = JSON.parse(bytes.toString('utf8'));
      if (state.schemaVersion !== 1 || !state.values || typeof state.values !== 'object' || Array.isArray(state.values)) throw Error('旧状态版本或结构无效');
      temporary = path.join(target, `.desktop-state.${randomUUID()}.tmp`);
      const staged = await fs.open(temporary, 'wx');
      try { await staged.writeFile(bytes); await staged.sync(); } finally { await staged.close(); }
      try { await fs.link(temporary, destination); }
      catch (error) { if (error.code === 'EEXIST') return { status: 'existing' }; throw error; }
      return { status: 'imported', source: directory };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      return { status: 'warning', message: `旧版数据未自动导入：${directory}（${error.message}）。旧目录完整保留。` };
    } finally { if (temporary) await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  return { status: 'empty' };
}
module.exports = { migrateProfile };
