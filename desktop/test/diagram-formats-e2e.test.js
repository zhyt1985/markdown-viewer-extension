import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { documentMenu, exportFile, launchDesktop, openFile, openWorkspace } from './ui-helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const fence = (type, body) => `\`\`\`${type}\n${body}\n\`\`\``;
const lite = data => JSON.stringify({ data, width: 150, height: 80, mark: 'bar',
  encoding: { x: { field: 'name', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } } });
const rows = [{ name: 'A', value: 3 }, { name: 'B', value: 7 }];

test('packaged desktop renders standalone files and Markdown fences with local diagram engines', { timeout: 120000 }, async t => {
  const executable = process.env.MV_DESKTOP_EXECUTABLE;
  const artifacts = path.join(root, 'test-results/desktop', executable ? 'packaged' : 'development', 'diagram-formats');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'run-'));
  const workspace = path.join(folder, 'workspace');
  const dataFolder = path.join(workspace, '数据');
  const charts = path.join(workspace, '图表');
  await Promise.all([fs.mkdir(dataFolder, { recursive: true }), fs.mkdir(charts, { recursive: true })]);
  const drawio = (await fs.readFile(path.join(root, 'test/fixtures/diagrams/simple.drawio'), 'utf8')).trim()
    .replace('rounded=0;', 'shape=mxgraph.basic.4_point_star;');
  const formats = [
    ['mermaid', 'MMD', 'flowchart LR\nA[Alpha] --> B[Beta]'],
    ['plantuml', 'puml', '@startuml\nAlice -> Bob: Hello\n@enduml'],
    ['vega', 'vega', JSON.stringify({ width: 120, height: 70, data: [{ name: 'rows', values: rows }],
      marks: [{ type: 'rect', from: { data: 'rows' }, encode: { enter: { x: { value: 12 }, y: { value: 12 }, x2: { value: 72 }, y2: { value: 42 }, fill: { value: '#109040' } } } }] })],
    ['vega-lite', 'vl', lite({ values: rows })],
    ['dot', 'gv', 'digraph G { Alpha -> Beta }'],
    ['infographic', 'infographic', 'infographic list-grid-badge-card\ndata\n  title Offline\n  items\n    - label Alpha\n    - label Beta'],
    ['canvas', 'canvas', JSON.stringify({ nodes: [{ id: '1', type: 'text', x: 0, y: 0, width: 180, height: 70, text: 'Offline' }], edges: [] })],
    ['drawio', 'drawio', drawio],
    ['echarts', 'echarts', JSON.stringify({ xAxis: { type: 'category', data: ['A', 'B'] }, yAxis: {}, series: [{ type: 'bar', data: [3, 7] }] })],
  ];
  const fileFor = ext => path.join(charts, `离线 #%.${ext}`);
  const mixed = path.join(charts, '代码块.md');
  const bad = path.join(charts, '错误.dot');
  const errors = path.join(charts, '错误块.md');
  const many = path.join(charts, 'Many diagrams.md');
  const iconFile = path.join(charts, 'Offline icons.md');
  const iconFlow = 'flowchart LR\n A["fa:fa-spinner"] --> B["fab:fa-twitter"] --> C["far:fa-circle"] --> D["fas:fa-ban"]\n E@{ icon: "fa:user", form: "square", label: "User" }';
  const localData = path.join(dataFolder, '表 #%.csv');
  const linked = path.join(charts, '相对数据.vega-lite');
  const localFence = path.join(charts, '相对数据.md');
  const blocked = path.join(charts, '越界数据.vl');
  const remote = path.join(charts, '远程数据.vl');
  const dataReference = lite({ url: '../数据/表%20%23%25.csv' });
  const invalid = {
    mermaid: 'flowchart LR\nA -->', plantuml: '@startuml\nAlice -> Bob: Hello\ninvalid diagram\n@enduml', vega: '{invalid',
    'vega-lite': '{invalid', dot: 'digraph { broken -> }',
    infographic: 'infographic list-grid-badge-card\ndata\n  items\n    - label Invalid\ntheme\n  colorBg invalid-css-color',
    canvas: '{invalid', drawio: '<notDrawio/>', echarts: '{invalid',
  };
  let errorMarkdown = '# Keep reading\n\n';
  const errorLines = Object.entries(invalid).map(([type, body]) => {
    const line = errorMarkdown.split('\n').length;
    errorMarkdown += `${fence(type, body)}\n\n`;
    return [type, line];
  });
  errorMarkdown += `${fence('mermaid', formats[0][2])}\n\nStill readable.`;
  await Promise.all([
    ...formats.map(([, ext, body]) => fs.writeFile(fileFor(ext), body)),
    fs.writeFile(mixed, '# Offline diagrams\n\n' + formats.map(([type, , body]) => fence(type, body)).join('\n\n')),
    fs.writeFile(bad, 'digraph { broken -> }'),
    fs.writeFile(errors, errorMarkdown),
    fs.writeFile(iconFile, fence('mermaid', iconFlow)),
    fs.writeFile(many, '# Diagram queue\n\n' + Array.from({ length: 105 }, (_, i) => fence('mermaid',
      `flowchart LR\nA --> N${i}`)).join('\n\n') + '\n\n' + fence('mermaid',
      'sequenceDiagram\nparticipant Alice\nparticipant Bob\nlink Alice: Reference @ https://example.invalid/reference\nAlice->>Bob: Hello')),
    fs.writeFile(localData, 'name,value\nA,3\nB,7\n'),
    fs.writeFile(linked, dataReference),
    fs.writeFile(localFence, fence('vega-lite', dataReference)),
    fs.writeFile(blocked, lite({ url: '../数据/outside/secret.csv' })),
    fs.writeFile(remote, lite({ url: 'https://example.invalid/remote.csv' })),
    fs.writeFile(path.join(folder, 'secret.csv'), 'name,value\nX,900\n'),
    fs.symlink(folder, path.join(dataFolder, 'outside'), process.platform === 'win32' ? 'junction' : 'dir'),
  ]);

  const app = await launchDesktop({ executablePath: executable || require('electron'),
    args: [`--user-data-dir=${path.join(folder, 'profile')}`, ...(executable ? [] : [path.join(root, 'dist/desktop/app')])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const ready = () => page.waitForFunction(() => Boolean(window.desktopApp) && !window.desktopApp.state().busy);
    await ready();
    const state = () => page.evaluate(() => window.desktopApp.state());
    const status = () => page.locator('#status').innerText();
    async function pick(file, action = openFile) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await action(page);
      await ready();
    }
    const diagram = type => page.locator(`#markdown-content .diagram-block[data-plugin-type="${type}"] img`);
    const workerScript = script => app.evaluate(({ BrowserWindow }, script) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL() === 'documd://render/render-host.html').webContents.executeJavaScript(script), script);
    async function assertDiagram(type) {
      assert.equal((await state()).preview.current, true, await status());
      assert.equal(await diagram(type).count(), 1, type);
      const { width, height } = await diagram(type).evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }));
      assert.ok(width > 10 && height > 10, `${type}: ${width}×${height}`);
    }

    await t.test('renders more diagrams than the host queue can hold, including a sequence actor link', async () => {
      await pick(many);
      assert.equal((await state()).preview.current, true, await status());
      assert.equal(await diagram('mermaid').count(), 106);
      assert.ok(await diagram('mermaid').evaluateAll(images => images.every(image => image.naturalWidth > 0)));
      assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), []);
      await page.locator('.tab-close').click();
      await ready();
    });

    await t.test('packaged Mermaid draws local Font Awesome paths in labels and icon nodes', async () => {
      await pick(iconFile);
      await assertDiagram('mermaid');
      const result = await workerScript(`window.renderHost(${JSON.stringify({ renderType: 'mermaid', input: iconFlow })})`);
      for (const [pack, name] of [['fa-solid', 'spinner'], ['fa-brands', 'twitter'], ['fa-regular', 'circle'],
        ['fa-solid', 'ban'], ['fa-solid', 'user']]) {
        const { body } = require(`@iconify/json/json/${pack}.json`).icons[name];
        const pathData = /<path d="([^"]+)"/.exec(body)?.[1];
        assert.ok(pathData && result.svg.includes(pathData), `missing vector path for ${pack}:${name}`);
      }
      await page.locator('.tab-close').click();
      await ready();
    });

    await t.test('all registered diagram types open directly and render as fenced Markdown', async () => {
      for (const [type, ext] of formats) {
        await pick(fileFor(ext));
        const document = (await state()).document;
        assert.equal(document.diagramType, type);
        assert.equal(document.readOnly, true);
        assert.equal(await page.locator('#save').isDisabled(), true);
        await assertDiagram(type);
        if (type === 'mermaid') await workerScript(`
          window.stencilResponses = [];
          const renderFetch = window.fetch;
          window.fetch = async (...args) => {
            const response = await renderFetch(...args);
            if (String(args[0]).includes('/stencils/')) window.stencilResponses.push([args[0], response.status]);
            return response;
          };
          undefined;
        `);
      }
      await pick(mixed);
      for (const [type] of formats) await assertDiagram(type);
      assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), []);
      const stencils = await workerScript('window.stencilResponses');
      assert.ok(stencils?.some(([url, code]) => url === 'documd://render/assets/stencils/basic.json' && code === 200),
        `DrawIO should load a bundled stencil; got ${JSON.stringify(stencils)}`);
    });

    await t.test('raw source is read-only and the standalone diagram exports while source is visible', async () => {
      await pick(fileFor('gv'));
      await assertDiagram('dot');
      await documentMenu(page, '#diagram-source');
      assert.equal(await page.locator('#mv-source-view').isVisible(), true);
      assert.match(await page.locator('#mv-source-view').innerText(), /Alpha -> Beta/);
      assert.equal(await page.locator('#markdown-content').isVisible(), false);
      for (const format of ['docx', 'pdf']) {
        const output = path.join(folder, `offline.${format}`);
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await exportFile(page, format);
        await page.waitForFunction(() => !window.desktopApp.state().exporting);
        assert.match(await status(), /已保存/);
        const bytes = await fs.readFile(output);
        if (format === 'docx') assert.ok(Object.keys(unzipSync(bytes)).some(name => name.startsWith('word/media/')));
        else assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      }
      assert.equal(await page.locator('#mv-source-view').isVisible(), true);
      await documentMenu(page, '#diagram-source');
      assert.equal(await diagram('dot').isVisible(), true);
      assert.equal(await fs.readFile(fileFor('gv'), 'utf8'), formats[4][2]);
    });

    await t.test('invalid diagrams retain source diagnostics and neighboring Markdown content', async () => {
      await pick(bad);
      assert.equal(await page.locator('#export-open').isDisabled(), true);
      assert.equal(await page.locator('.mv-plugin-error[data-plugin-type="dot"]').count(), 1);
      await documentMenu(page, '#diagram-source');
      assert.match(await page.locator('#mv-source-view').innerText(), /broken ->/);
      await pick(errors);
      const diagnostics = await page.evaluate(() => window.desktopViewer.diagnostics());
      assert.deepEqual(diagnostics.sort((a, b) => a.line - b.line).map(({ type, line }) => [type, line]), errorLines);
      assert.equal(await diagram('mermaid').isVisible(), true);
      assert.match(await page.locator('#markdown-content').innerText(), /Still readable/);
      assert.equal(await page.locator('#export-open').isDisabled(), true);
    });

    await t.test('Vega reads workspace-relative CSV from disk and reports remote or escaping data references', async () => {
      await pick(workspace, openWorkspace);
      await page.locator('.tree-dir[data-name="图表"]').click();
      async function workspaceFile(file) {
        await page.locator('.tree-file', { hasText: path.basename(file) }).click();
        await ready();
        assert.equal((await state()).document.filename, path.basename(file));
      }
      await workspaceFile(linked);
      await assertDiagram('vega-lite');
      const original = await diagram('vega-lite').getAttribute('src');
      await fs.writeFile(localData, 'name,value\nA,9\nB,2\nC,30\n');
      await documentMenu(page, '#reload-file');
      await ready();
      await assertDiagram('vega-lite');
      assert.ok((await diagram('vega-lite').getAttribute('src')) !== original, 'changing CSV data must change the chart');
      await workspaceFile(localFence);
      await assertDiagram('vega-lite');
      for (const file of [blocked, remote]) {
        await workspaceFile(file);
        assert.match(await status(), /authorized directory/);
        assert.equal(await page.locator('#export-open').isDisabled(), true);
        assert.equal(await page.locator('.mv-plugin-error[data-plugin-type="vega-lite"]').count(), 1);
      }
    });
  } finally { await app.close(); }
});
