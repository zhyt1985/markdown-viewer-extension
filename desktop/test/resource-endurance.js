// Observational P6 benchmark. Run against a packaged desktop executable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { closeDialogs, exportFile, launchDesktop, openFile, openSettings } from './ui-helpers.js';

const executablePath = process.env.MV_DESKTOP_EXECUTABLE;
if (!executablePath) throw Error('Set MV_DESKTOP_EXECUTABLE to a packaged desktop executable');
const trials = Number(process.env.MV_DESKTOP_PERF_SAMPLES ?? 5);
assert.ok(Number.isInteger(trials) && trials >= 5 && trials <= 20, 'Use 5 to 20 long-document trials');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'documd-p6-endurance-')));
const base = path.join(root, 'reference.md');
const long = path.join(root, 'long.md');
const longTitle = 'P6 long-document benchmark';
const longLead = 'The opening paragraph appears before the fifty diagrams finish.';
const unique = Array.from({ length: 50 }, (_, i) => path.join(root, `cycle-${String(i + 1).padStart(2, '0')}.md`));
const formats = ['docx', 'pdf', 'html', 'png'];
const lines = [`# ${longTitle}`, '', longLead, ''];
for (let i = 1; i <= 50; i++) {
  const figure = i % 2 ? ['```mermaid', 'flowchart LR', `A["Input ${i}"] --> B["Result ${i}"]`] :
    ['```dot', 'digraph {', `input -> "Result ${i}"; }`];
  lines.push(`## Figure ${i}`, '', ...figure, '```', '');
  for (let paragraph = 1; paragraph <= 24; paragraph++) {
    lines.push(`Section ${i}, paragraph ${paragraph}.`, 'Local reading, diagrams and navigation.',
      'This paragraph has six lines of fixture text.', 'No external files are needed.',
      'The headings and paragraphs create multiple rendering blocks.', 'End of paragraph.', '', '');
  }
}
while (lines.length < 10000) lines.push(lines.length % 2 ? '' : 'Final local paragraph.');
assert.equal(lines.length, 10000);
const markdown = lines.join('\n') + '\n';
const reference = '# Reference document\n\nFixed sample for the four export formats.\n\n'
  + '| Type | Value |\n| --- | --- |\n| Export | 42 |\n\n'
  + '```mermaid\nflowchart LR\nA[Read] --> B[Export]\n```\n';
const record = {
  environment: { platform: os.platform(), arch: os.arch(), kernel: os.release(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() },
  fixtures: {
    long: { lines: lines.length, diagrams: 50, bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex') },
    reference: { sha256: createHash('sha256').update(reference).digest('hex') },
  },
  progressive: [], checkpoints: [], exports: [],
};

async function run(profile, callback) {
  const app = await launchDesktop({ executablePath, args: [`--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(90000);
    await page.waitForFunction(() => window.desktopApp && !window.desktopApp.state().busy);
    if (!record.environment.version) {
      Object.assign(record.environment, await app.evaluate(({ app, screen }) => {
        const display = screen.getPrimaryDisplay();
        return { version: app.getVersion(), electron: process.versions.electron,
          display: { ...display.size, scaleFactor: display.scaleFactor } };
      }));
    }
    await callback(app, page);
  } finally { await app.close(); }
}

const open = async (app, page, file) => {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await openFile(page);
};
const ready = (page, file) => page.waitForFunction(filename => {
  const state = window.desktopApp.state();
  return !state.busy && state.document?.filename === filename && state.preview.current;
}, path.basename(file));

async function progressive(app, page, round, switchEarly) {
  await open(app, page, base);
  await ready(page, base);
  await page.evaluate(({ title, lead }) => {
    const reader = document.getElementById('reader');
    const button = document.getElementById('open');
    const reference = () => [...document.querySelectorAll('.tab-open')].find(tab => tab.textContent === 'reference.md');
    const diagrams = () => document.querySelectorAll('#markdown-content .diagram-block img').length;
    const result = window.__longProbe = {};
    button.addEventListener('click', () => {
      const started = performance.now();
      const elapsed = () => performance.now() - started;
      const tabs = document.getElementById('tabs');
      const recordClick = event => {
        if (result.attemptMs !== undefined && event.target.closest('.tab-open') === reference()) {
          result.clickMs = elapsed();
        }
      };
      tabs.addEventListener('click', recordClick, true);
      const frame = () => {
        const content = document.getElementById('markdown-content');
        const heading = content.querySelector('h1');
        const paragraph = content.querySelector('p');
        const state = window.desktopApp.state();
        if (result.firstMs === undefined && heading?.textContent === title && paragraph?.textContent === lead) {
          const r = paragraph.getBoundingClientRect();
          const view = reader.getBoundingClientRect();
          if (r.height > 0 && r.top < view.bottom && r.bottom > view.top) {
            result.firstMs = elapsed();
            result.diagramsAtFirst = diagrams();
          }
        }
        if (result.firstMs !== undefined && result.scrollMs === undefined && reader.scrollTop > 40 && state.document?.filename === 'long.md') {
          result.scrollMs = elapsed();
          result.scrollTop = reader.scrollTop;
          result.diagramsAtScroll = diagrams();
        }
        if (result.attemptMs !== undefined && result.availableMs === undefined && reference() && !reference().disabled) {
          result.availableMs = elapsed();
        }
        if (result.clickMs !== undefined && state.document?.filename === 'reference.md'
            && result.targetFirstMs === undefined && heading?.textContent === 'Reference document'
            && heading.getBoundingClientRect().height > 0) result.targetFirstMs = elapsed();
        if (state.document?.filename === 'long.md' && !state.busy && state.preview.current) {
          result.completeMs = elapsed();
          result.diagramsAtCompletion = diagrams();
          result.scrollTopAtCompletion = reader.scrollTop;
          tabs.removeEventListener('click', recordClick, true);
          return;
        }
        if (result.attemptMs !== undefined && state.document?.filename === 'reference.md' && !state.busy && state.preview.current) {
          result.switchedMs = elapsed();
          tabs.removeEventListener('click', recordClick, true);
          return;
        }
        requestAnimationFrame(frame);
      };
      window.__markSwitch = () => {
        const target = reference();
        result.attemptMs = elapsed();
        result.disabledAtAttempt = target.disabled;
        result.diagramsAtAttempt = diagrams();
        result.busyAtAttempt = window.desktopApp.state().busy;
        const rect = target.getBoundingClientRect();
        return [rect.x + rect.width / 2, rect.y + rect.height / 2];
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  }, { title: longTitle, lead: longLead });
  await open(app, page, long);
  await page.waitForFunction(() => Number.isFinite(window.__longProbe?.firstMs));
  const reader = await page.locator('#reader').boundingBox();
  await page.mouse.move(reader.x + reader.width * 0.6, reader.y + reader.height * 0.5);
  await page.mouse.wheel(0, 680);
  if (switchEarly) {
    // A physical click records whether a tab was actually enabled at that time.
    const [x, y] = await page.evaluate(() => window.__markSwitch());
    await page.mouse.click(x, y);
  }
  await page.waitForFunction(() => {
    const result = window.__longProbe;
    return Number.isFinite(result.completeMs) || Number.isFinite(result.switchedMs);
  });
  const outcome = await page.evaluate(() => window.__longProbe);
  if (outcome.completeMs !== undefined) {
    assert.equal(outcome.diagramsAtCompletion, 50);
    assert.deepEqual(await page.evaluate(() => window.desktopViewer.diagnostics()), []);
    if (outcome.disabledAtAttempt) {
      const start = performance.now();
      await page.locator('.tab-open', { hasText: 'reference.md' }).click();
      await ready(page, base);
      outcome.switchAfterReadyMs = performance.now() - start;
    }
  }
  record.progressive.push({ round, scenario: switchEarly ? 'switch-while-rendering' : 'finish-rendering', ...outcome });
}

async function endurance(app, page) {
  await open(app, page, base);
  await ready(page, base);
  const cdp = await page.context().newCDPSession(page);
  await app.evaluate((_electron, files) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const original = fs.stat;
    const candidates = new Set(files);
    globalThis.__endurancePolls = null;
    fs.stat = function (file, ...args) {
      if (globalThis.__endurancePolls && candidates.has(file)) {
        globalThis.__endurancePolls[file] = (globalThis.__endurancePolls[file] || 0) + 1;
      }
      return original.call(this, file, ...args);
    };
  }, [base, ...unique]);

  async function checkpoint(label, docs, exports) {
    await app.evaluate(() => { globalThis.__endurancePolls = Object.create(null); });
    await delay(1650); // More than two idle document-monitor intervals.
    const appData = await app.evaluate(({ app, BrowserWindow, webContents }) => {
      const polls = globalThis.__endurancePolls;
      globalThis.__endurancePolls = null;
      const metrics = app.getAppMetrics();
      return { polls, processes: metrics.map(p => ({ pid: p.pid, type: p.type, workingSetKiB: p.memory.workingSetSize })),
        windows: BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), url: w.webContents.getURL() })),
        webContents: webContents.getAllWebContents().map(contents => ({ type: contents.getType(), url: contents.getURL() })),
        mainHeapBytes: process.memoryUsage().heapUsed };
    });
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const polls = Object.entries(appData.polls).map(([name, count]) => [path.basename(name), count]);
    record.checkpoints.push({ label, docs, exports, ...appData, polls, viewerHeapBytes: usedSize,
      totalWorkingSetKiB: appData.processes.reduce((sum, p) => sum + p.workingSetKiB, 0) });
  }

  await checkpoint('baseline', 0, 0);
  for (const [i, file] of unique.entries()) {
    await open(app, page, file);
    await ready(page, file);
    await page.locator('.document-tab.selected .tab-close').click();
    await ready(page, base);
    if ((i + 1) % 10 === 0) {
      await checkpoint('document-cycle', i + 1, 0);
      console.error(`completed ${i + 1}/50 document cycles`);
    }
  }
  for (let i = 0; i < 20; i++) {
    const format = formats[i % formats.length];
    const file = path.join(root, `output-${i + 1}.${format}`);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await exportFile(page, format);
    await page.waitForFunction(() => {
      const state = window.desktopApp.state();
      return !state.exporting && state.task?.state !== 'running';
    });
    const task = await page.evaluate(() => window.desktopApp.state().task);
    assert.equal(task.state, 'complete', JSON.stringify(task));
    const bytes = await fs.readFile(file);
    const signatures = { docx: /^504b0304/, pdf: /^255044462d/, html: /^3c21646f6374797065/, png: /^89504e470d0a1a0a/ };
    assert.match(bytes.subarray(0, 12).toString('hex'), signatures[format]);
    record.exports.push({ format, bytes: bytes.length });
    if ((i + 1) % 5 === 0) {
      await checkpoint('export-cycle', 50, i + 1);
      console.error(`completed ${i + 1}/20 exports`);
    }
  }
  await openSettings(page);
  await page.click('#clear-cache');
  await page.waitForFunction(() => /缓存：0 项/.test(document.getElementById('cache-status').textContent));
  await closeDialogs(page);
  await checkpoint('after-cache-clear', 50, 20);
  await cdp.detach();
}

try {
  await Promise.all([fs.writeFile(long, markdown), fs.writeFile(base, reference),
    ...unique.map((file, i) => fs.writeFile(file, `# Cycle ${i + 1}\n\nThis is a distinct local document.\n`))]);
  for (let round = 1; round <= trials; round++) {
    await run(path.join(root, `progressive-${round}`), (app, page) => progressive(app, page, round, false));
    await run(path.join(root, `switch-${round}`), (app, page) => progressive(app, page, round, true));
    console.error(`completed long-document trial ${round}/${trials} (finish and switch)`);
  }
  if (process.env.MV_DESKTOP_ENDURANCE_LONG_ONLY !== '1') await run(path.join(root, 'endurance'), endurance);
  console.log(JSON.stringify(record, null, 2));
} finally { await fs.rm(root, { recursive: true, force: true }); }
