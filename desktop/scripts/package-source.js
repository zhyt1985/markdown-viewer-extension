// Bundle the current working source for handoff without dependencies or generated files.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
const output = path.join(root, 'dist/desktop/handoff');
const readJSON = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const { name, version } = await readJSON('desktop/app-manifest.json');
const desktop = await readJSON('desktop/package.json');
if (name !== 'documd-desktop' || !/^0\.1\.0-alpha\.\d+$/.test(version) || version !== desktop.version) {
  throw Error('Desktop package and manifest versions do not match');
}
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
const paths = (mode, ...extra) => git('ls-files', '-z', mode, ...extra).split('\0').filter(Boolean);
const tracked = paths('--cached');
const untracked = paths('--others', '--exclude-standard', '--', 'desktop', 'src', 'test/suites')
  .filter(file => /^(?:desktop\/(?:src\/|test\/|scripts\/|[^/]+\.md$)|src\/|test\/suites\/)/.test(file)
    && /\.(?:cjs|mjs|js|ts|html|css|json|md)$/.test(file));
const candidates = [...new Set([...tracked, ...untracked])].sort();
const files = [];
for (const file of candidates) {
  if (/^(?:docs|skills)(?:\/|$)/.test(file)) continue; // Optional Git submodules.
  if (file.split('/').some(part => ['.git', 'node_modules', 'dist', 'test-results', '.cache'].includes(part) || /^\.env(?:\.|$)/.test(part))) continue;
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw Error(`Invalid source archive entry: ${file}`);
  const stats = await fs.lstat(path.join(root, file)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null; // An intentionally deleted tracked file is absent from the working snapshot.
  });
  if (!stats) continue;
  if (!stats.isFile()) throw Error(`Expected a regular source file: ${file}`);
  if (await fs.realpath(path.join(root, file)) !== path.join(root, file)) throw Error(`Linked source path: ${file}`);
  files.push(file);
}
const coverage = await readJSON('desktop/test/feature-coverage.json');
const included = new Set(files);
const required = ['package.json', 'package-lock.json', 'desktop/package-lock.json', 'desktop/build.js',
  'desktop/app-manifest.json', 'desktop/WINDOWS_X64_REGRESSION.zh-CN.md', 'desktop/P6_DELIVERY.zh-CN.md',
  'desktop/P6_COVERAGE_AUDIT.zh-CN.md', 'desktop/P6_CANDIDATE_TRIAL.zh-CN.md',
  'desktop/P6_DOCUMENT_TRIAL.zh-CN.md', 'desktop/P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md',
  'desktop/FONT_AWESOME_NOTICE.md', 'desktop/MACOS_ARM64_CANDIDATE.zh-CN.md', 'desktop/scripts/package-source.js',
  ...coverage.features.flatMap(feature => feature.evidence)];
for (const file of required) if (!included.has(file)) throw Error(`Missing handoff file: ${file}`);

await fs.mkdir(output, { recursive: true });
const filename = `documd-${version}-source.tar.gz`;
const archive = path.join(output, filename);
const partial = path.join(output, `.${filename}.${randomUUID()}.tmp`);
try {
  execFileSync('tar', ['-czf', partial, '--null', '--no-recursion', '-T', '-'], {
    cwd: root, input: Buffer.from(files.join('\0') + '\0'), env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const digest = createHash('sha256').update(await fs.readFile(partial)).digest('hex');
  const { size } = await fs.stat(partial);
  await fs.rename(partial, archive);
  await fs.writeFile(archive + '.sha256', `${digest}  ${filename}\n`);
  await fs.writeFile(path.join(output, `documd-${version}-source.json`), JSON.stringify({
    version, electron: desktop.devDependencies.electron, baseCommit: git('rev-parse', 'HEAD').trim(),
    snapshot: 'current working source; may include local changes',
    archive: filename, sha256: digest, bytes: size, files: files.length,
  }, null, 2) + '\n');
  console.log(`${archive}\n${digest}  ${filename}\n${files.length} files, ${size} bytes`);
} finally { await fs.rm(partial, { force: true }); }
