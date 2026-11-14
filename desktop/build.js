import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dagreShimPlugin } from '../scripts/dagre-shim-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const rootRequire = createRequire(path.join(root, 'package.json'));
const desktopRequire = createRequire(path.join(here, 'package.json'));
const dependencyGroups = [
  { resolve: rootRequire.resolve, packages: ['esbuild', '@markdown-viewer/drawio2svg', '@iconify/json/json/fa-solid.json', 'vite', 'tsx'], command: 'npm ci' },
  { resolve: desktopRequire.resolve, packages: ['iconv-lite', '@codemirror/state', '@codemirror/view',
    '@codemirror/commands', '@codemirror/lang-markdown', '@codemirror/language', '@codemirror/search'],
    command: 'npm --prefix desktop ci' },
];
const missing = dependencyGroups.flatMap(({ resolve, packages, command }) => {
  const names = packages.filter(name => {
    try { resolve(name); return false; } catch { return true; }
  });
  return names.length ? [`Missing build dependencies: ${names.join(', ')}\nRun from the repository root: ${command}`] : [];
});
if (missing.length) {
  console.error(missing.join('\n'));
  process.exit(1);
}
const { build } = await import('esbuild');
const output = path.join(root, 'dist/desktop/app');
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
const iconSets = Object.fromEntries(Object.entries({ fas: 'fa-solid', far: 'fa-regular', fab: 'fa-brands' }).map(([prefix, name]) => {
  const { icons, aliases, width, height, info } = rootRequire(`@iconify/json/json/${name}.json`);
  return [prefix, { prefix, icons, aliases, width, height, info }];
}));
await fs.writeFile(path.join(output, 'assets/mermaid-fontawesome.json'), JSON.stringify(iconSets));
await fs.copyFile(path.join(here, 'FONT_AWESOME_NOTICE.md'), path.join(output, 'FONT_AWESOME_NOTICE.md'));
const slidev = path.join(output, 'assets/slidev');
execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'slidev-shell/vite.config.ts', '--outDir', slidev], { cwd: root, stdio: 'inherit',
  env: { ...process.env, DOCUMD_SLIDEV_BUNDLE_FONTS: '1' } });
execFileSync(process.execPath, ['--import', 'tsx', 'slidev-shell/build-themes.ts'], { cwd: root, stdio: 'inherit',
  env: { ...process.env, DOCUMD_SLIDEV_THEME_DIR: path.join(slidev, 'themes') } });
const slideThemes = JSON.parse(await fs.readFile(path.join(slidev, 'themes/themes.json'), 'utf8'));
await Promise.all(['default', 'seriph', 'apple-basic', 'bricks', 'dracula', 'purplin', 'academic', 'geist', 'unicorn'].map(name =>
  fs.access(path.join(slidev, 'themes', slideThemes[name]?.file || `missing-theme-${name}`))));
await build({
  entryPoints: {
    'text-codecs': path.join(here, 'src/text-codecs.cjs'), 'annotation-data': path.join(here, 'src/annotation-data.ts'),
    'desktop-locale': path.join(here, 'src/desktop-locale.ts'),
    'document-types': path.join(here, 'src/document-types.cjs'),
  },
  outdir: output, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: ['node22'], minify: true,
});
// Replace the prototype CLI bundle; it must not survive in the desktop artifact.
await fs.rm(path.join(output, 'assets/browser-renderer.js'), { force: true });
await build({
  entryPoints: { 'desktop-editor': path.join(here, 'src/editor.ts'), 'desktop-viewer': path.join(here, 'src/viewer.ts'), 'desktop-annotations': path.join(here, 'src/annotations.ts'), 'render-host': path.join(here, 'src/render-host.ts') }, outdir: path.join(output, 'assets'),
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome120'], minify: true,
  define: { 'process.env.NODE_ENV': '"production"', MV_PLATFORM: '"desktop"', MV_RUNTIME: '"webview"', global: 'globalThis' },
  inject: [path.join(root, 'scripts/buffer-shim.js')],
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  external: ['web-worker'], plugins: [dagreShimPlugin],
});
await build({ entryPoints: [path.join(root, 'src/ui/styles.css')], outfile: path.join(output, 'assets/styles.css'),
  bundle: true, minify: true, loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl' } });
await fs.cp(path.join(root, 'src/themes'), path.join(output, 'assets/themes'), { recursive: true });
await fs.cp(path.join(root, 'src/_locales'), path.join(output, 'assets/_locales'), { recursive: true });
await fs.cp(path.join(root, 'node_modules/@markdown-viewer/drawio2svg/resources/stencils'), path.join(output, 'assets/stencils'), { recursive: true });
for (const name of ['main.cjs', 'preload.cjs', 'export-preload.cjs', 'window-worker.cjs', 'resource-policy.cjs', 'state-store.cjs', 'disk-cache.cjs', 'app-services.cjs', 'workspaces.cjs', 'navigation-history.cjs', 'workspace-search.cjs', 'document-files.cjs', 'document-monitor.cjs', 'profile-migration.cjs', 'renderer.js', 'shell.js', 'index.html', 'render-host.html', 'export.html', 'desktop.css', 'pdf-options.cjs']) {
  await fs.copyFile(path.join(here, 'src', name), path.join(output, name));
}
const pdfJs = path.dirname(desktopRequire.resolve('pdfjs-dist/package.json'));
const pdfAssets = path.join(output, 'assets/pdfjs');
await fs.mkdir(pdfAssets, { recursive: true });
for (const file of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs', 'LICENSE']) {
  await fs.copyFile(path.join(pdfJs, file), path.join(pdfAssets, path.basename(file)));
}
await fs.copyFile(path.join(here, 'src/pdf-preview.js'), path.join(output, 'assets/pdf-preview.js'));
await fs.copyFile(path.join(here, 'src/draft-store.cjs'), path.join(output, 'draft-store.cjs'));
await fs.copyFile(path.join(here, 'src/open-inbox.cjs'), path.join(output, 'open-inbox.cjs'));
await fs.copyFile(path.join(here, 'src/local-navigation.cjs'), path.join(output, 'local-navigation.cjs'));
await fs.copyFile(path.join(here, 'src/annotation-store.cjs'), path.join(output, 'annotation-store.cjs'));
await fs.copyFile(path.join(here, 'src/html-preview.cjs'), path.join(output, 'html-preview.cjs'));
await fs.copyFile(path.join(here, 'src/vega-data.cjs'), path.join(output, 'vega-data.cjs'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const desktop = JSON.parse(await fs.readFile(path.join(here, 'app-manifest.json'), 'utf8'));
await fs.copyFile(path.join(here, 'app-manifest.json'), path.join(output, 'app-manifest.json'));
await fs.copyFile(path.join(here, 'src/reading-font-defaults.json'), path.join(output, 'reading-font-defaults.json'));
await fs.writeFile(path.join(output, 'package.json'), JSON.stringify({
  name: desktop.name, productName: desktop.productName,
  version: desktop.version, main: 'main.cjs', license: pkg.license,
}, null, 2));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await fs.copyFile(path.join(root, 'settings-schema.json'), path.join(output, 'settings-schema.json'));
console.log(`Desktop application assets: ${output}`);
