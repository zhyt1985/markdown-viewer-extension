import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { dagreShimPlugin } from '../scripts/dagre-shim-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const output = path.join(root, 'dist/desktop/app');
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
await build({entryPoints:[path.join(here,'src/text-codecs.cjs')],outfile:path.join(output,'text-codecs.cjs'),bundle:true,platform:'node',format:'cjs',target:['node22'],minify:true});
// Replace the prototype CLI bundle; it must not survive in the desktop artifact.
await fs.rm(path.join(output, 'assets/browser-renderer.js'), { force: true });
await build({
  entryPoints: { 'desktop-editor': path.join(here, 'src/editor.ts'), 'desktop-viewer': path.join(here, 'src/viewer.ts'), 'render-host': path.join(here, 'src/render-host.ts') }, outdir: path.join(output, 'assets'),
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
for (const name of ['main.cjs', 'preload.cjs', 'export-preload.cjs', 'window-worker.cjs', 'resource-policy.cjs', 'state-store.cjs', 'disk-cache.cjs', 'app-services.cjs', 'workspaces.cjs', 'navigation-history.cjs', 'workspace-search.cjs', 'document-files.cjs', 'document-monitor.cjs', 'profile-migration.cjs', 'renderer.js', 'shell.js', 'index.html', 'render-host.html', 'export.html', 'desktop.css']) {
  await fs.copyFile(path.join(here, 'src', name), path.join(output, name));
}
await fs.copyFile(path.join(here, 'src/draft-store.cjs'), path.join(output, 'draft-store.cjs'));
await fs.copyFile(path.join(here, 'src/open-inbox.cjs'), path.join(output, 'open-inbox.cjs'));
await fs.copyFile(path.join(here, 'src/local-navigation.cjs'), path.join(output, 'local-navigation.cjs'));
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
