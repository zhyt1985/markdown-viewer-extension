const path = require('node:path');
const fs = require('node:fs/promises');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const windows = process.platform === 'win32';
const normalize = value => windows ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (a, b) => normalize(a) === normalize(b);
const contains = (root, target) => {
  const relative = path.relative(normalize(root), normalize(target));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const imageTypes = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg']);
const fontTypes = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const chartTypes = new Set(['.json', '.csv', '.tsv', '.topojson']);

function ordinaryPath(value) {
  if (windows && /^\\\\\?\\[a-z]:\\/i.test(value)) return value.slice(4);
  if (/^[\\/]{2}/.test(value)) throw Error('Network paths are not supported');
  return value;
}

function resourcePath(document, value, relative = true) {
  if (!document?.source || typeof value !== 'string' || !value || value.length > 32768 || /[\u0000-\u001f]/.test(value)) {
    throw Error('Invalid resource path');
  }
  if (/^file:/i.test(value)) {
    const url = new URL(value);
    if (url.host) throw Error('Network paths are not supported');
    return ordinaryPath(fileURLToPath(url));
  }
  const local = ordinaryPath(value);
  if (path.isAbsolute(local) && !relative) return path.resolve(local);
  if (!relative || /^[a-z][a-z\d+.-]*:|^[\\/#?]/i.test(local)) throw Error('Invalid relative resource path');
  const url = new URL(local.replace(/\\/g, '/'), pathToFileURL(document.source));
  if (url.protocol !== 'file:' || url.host) throw Error('Expected a local resource');
  return ordinaryPath(fileURLToPath(url));
}

function identity(stat) { return `${stat.dev}:${stat.ino}`; }

async function directoryIdentity(root) {
  const [canonical, stat] = await Promise.all([fs.realpath(root), fs.lstat(root, { bigint: true })]);
  if (!samePath(canonical, root) || !stat.isDirectory() || stat.isSymbolicLink()) throw Error('Resource folder was replaced');
  return identity(stat);
}

async function verifyLocalDrive(folder) {
  if (process.platform === 'darwin') {
    const { stdout } = await run('/sbin/mount', [], { timeout: 4000 });
    const matching = stdout.split('\n').flatMap(line => {
      const match = /^.*? on (.+) \(([^()]*)\)$/.exec(line);
      return match && path.isAbsolute(match[1]) && contains(match[1], folder) ? [match] : [];
    }).sort((a, b) => b[1].length - a[1].length)[0];
    if (!matching?.[2].split(', ').includes('local')) throw Error('Network or unavailable volumes are not supported');
    return;
  }
  if (!windows) return;
  const drive = /^([a-z]):[\\/]/i.exec(ordinaryPath(folder))?.[1];
  if (!drive) throw Error('Expected a local drive');
  // A mapped network drive also has a drive letter. Check the OS drive type
  // before opening it. Only a validated single drive letter reaches the command.
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `[System.IO.DriveInfo]::new('${drive}:').DriveType.ToString()`], { windowsHide: true, timeout: 6000 });
  if (!/^(?:Fixed|Removable|CDRom|Ram)$/i.test(stdout.trim())) throw Error('Network or unavailable drives are not supported');
}

async function extraResourceDirectory(value) {
  const selected = ordinaryPath(value);
  if (!path.isAbsolute(selected)) throw Error('Expected a local folder');
  await verifyLocalDrive(selected);
  const folder = ordinaryPath(await fs.realpath(selected));
  if (!samePath(selected, folder)) await verifyLocalDrive(folder);
  if (samePath(folder, path.parse(folder).root)) throw Error('A volume root cannot be authorized');
  return { folder, identity: await directoryIdentity(folder), revoked: false };
}

function allowedExtra(target, purpose) {
  const extension = path.extname(target).toLowerCase();
  if (purpose === 'image') return imageTypes.has(extension);
  if (purpose === 'chart') return chartTypes.has(extension);
  return imageTypes.has(extension) || fontTypes.has(extension);
}

async function validateResource(result) {
  if (result.extra && (result.extra.revoked || await directoryIdentity(result.root) !== result.extra.identity || result.extra.revoked)) {
    throw Error('Extra resource folder was replaced or revoked');
  }
}

async function resolveResource(document, candidate, purpose = 'asset') {
  if (contains(document.resourceRoot, candidate)) {
    return { root: document.resourceRoot, target: await within(document.resourceRoot, candidate) };
  }
  for (const extra of document.resourceFolders || []) {
    if (extra.revoked || !contains(extra.folder, candidate) || !allowedExtra(candidate, purpose)) continue;
    const result = { root: extra.folder, extra };
    await validateResource(result);
    result.target = await within(result.root, candidate);
    if (!allowedExtra(result.target, purpose)) throw Error('Unsupported extra resource type');
    const stat = await fs.stat(result.target, { bigint: true });
    if (!extra.identity.startsWith(`${stat.dev}:`)) throw Error('Resource is on a different volume');
    return result;
  }
  throw Error('Resource is outside the authorized folders');
}

// Compare canonical paths so ../, absolute paths and symlinks cannot escape a grant.
async function within(root, candidate) {
  const [base, target] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
  if (!samePath(base, root)) throw new Error('Granted folder was replaced or moved');
  if (!contains(base, target)) {
    throw new Error('Resource is outside the opened document folder');
  }
  return target;
}
module.exports = { within, contains, samePath, resourcePath, resolveResource, validateResource, extraResourceDirectory };
