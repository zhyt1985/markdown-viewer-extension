const path = require('node:path');
const fs = require('node:fs/promises');

// Compare canonical paths so ../, absolute paths and symlinks cannot escape a grant.
async function within(root, candidate) {
  const [base, target] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(base) !== normalize(root)) throw new Error('Granted folder was replaced or moved');
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Resource is outside the opened document folder');
  }
  return target;
}
module.exports = { within };
