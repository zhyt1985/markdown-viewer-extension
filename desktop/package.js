import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'desktop/app-manifest.json'), 'utf8'));
const electronVersion = (await import('electron/package.json', { with: { type: 'json' } })).default.version;
const electronZipDir = process.env.DOCUMD_ELECTRON_ZIP_DIR;
const filename = `electron-v${electronVersion}-${process.platform}-${process.arch}.zip`;
if (electronZipDir) {
  const checksums = (await import('electron/checksums.json', { with: { type: 'json' } })).default;
  const digest = createHash('sha256').update(await fs.readFile(path.join(electronZipDir, filename))).digest('hex');
  if (!checksums[filename] || digest !== checksums[filename]) throw Error('Cached Electron ZIP checksum mismatch');
  console.log(`Using verified local Electron ZIP: ${filename}`);
}
console.log(`Packaging ${manifest.productName} ${manifest.version} for ${process.platform}-${process.arch} (Electron ${electronVersion})`);
let outputs;
try {
  outputs = await packager({
    dir: path.join(root, 'dist/desktop/app'),
    out: path.join(root, 'dist/desktop/packages'),
    name: manifest.name,
    appBundleId: manifest.appId,
    appVersion: manifest.version,
    win32metadata: { ProductName: manifest.productName, FileDescription: manifest.productName, InternalName: manifest.name },
    platform: process.platform, arch: process.arch,
    electronVersion,
    ...(electronZipDir ? { electronZipDir } : {}),
    asar: true, overwrite: true,
  });
} catch (error) {
  if (!electronZipDir && (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/.test(`${error.message} ${error.cause?.code}`))) {
    console.error(`Electron download failed. Supply the official ${filename} in a local directory and set DOCUMD_ELECTRON_ZIP_DIR to that directory.\nSee desktop/BUILD.zh-CN.md for download and packaging instructions.`);
  }
  throw error;
}
console.log(outputs.join('\n'));
