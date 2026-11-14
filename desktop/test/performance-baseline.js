// Run separately from functional tests: metrics describe the local machine, not CI pass/fail limits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { exportFile, launchDesktop } from './ui-helpers.js';

const executablePath = process.env.MV_DESKTOP_EXECUTABLE;
if (!executablePath) throw Error('Set MV_DESKTOP_EXECUTABLE to a packaged desktop executable');
const samples = Number(process.env.MV_DESKTOP_PERF_SAMPLES ?? 5);
assert.ok(Number.isInteger(samples) && samples >= 5 && samples <= 20, 'Use 5 to 20 samples');

const title = 'P6 fixed Markdown baseline';
const lead = 'The first paragraph marks the initial viewport.';
const paragraph = 'This local Markdown fixture measures startup and ordinary document reading. '
  + 'The body is deterministic, with repeated prose, headings and paragraph breaks. '
  + 'No network resource, diagram, image or external font is required by this document. ';
const fixture = `# ${title}\n\n${lead}\n\n` + Array.from({ length: 900 }, (_, index) => (
  `## Section ${String(index + 1).padStart(4, '0')}\n\n${paragraph.repeat(3).trim()}\n\n`
)).join('');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'documd-p6-performance-'));
const source = path.join(root, 'baseline.md');
await fs.writeFile(source, fixture);

const result = {
  environment: { platform: os.platform(), arch: os.arch(), kernel: os.release(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  fixture: { bytes: Buffer.byteLength(fixture), lines: fixture.split('\n').length - 1,
    sha256: createHash('sha256').update(fixture).digest('hex') },
  samples: [],
};

async function launch(profile) {
  const before = performance.now();
  const app = await launchDesktop({ executablePath, args: [`--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    await page.waitForFunction(() => {
      const state = window.desktopApp?.state();
      const open = document.querySelector('#welcome [data-shell-action="open-file"]');
      return state && !state.busy && !state.document && open?.getClientRects().length
        && !document.getElementById('open').disabled;
    });
    const startupMs = performance.now() - before;
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, source);
    return { app, page, startupMs };
  } catch (error) { await app.close(); throw error; }
}

async function openMeasure(page) {
  await page.evaluate(({ title, lead }) => {
    const button = document.querySelector('#welcome [data-shell-action="open-file"]');
    const probe = window.__p6Open = { firstViewportMs: null, readyMs: null };
    button.addEventListener('click', () => {
      const start = performance.now();
      let frameFound = false;
      function nextFrame() {
        const heading = document.querySelector('#markdown-content h1');
        const paragraph = document.querySelector('#markdown-content p');
        const reader = document.getElementById('reader').getBoundingClientRect();
        const rect = paragraph?.getBoundingClientRect();
        if (heading?.textContent === title && paragraph?.textContent === lead &&
            rect?.height > 0 && rect.top < reader.bottom && rect.bottom > reader.top) {
          // Wait one more frame before counting the first visible viewport.
          if (frameFound && probe.firstViewportMs === null) probe.firstViewportMs = performance.now() - start;
          frameFound = true;
        } else frameFound = false;
        const state = window.desktopApp.state();
        if (probe.readyMs === null && !state.busy && state.preview.current && state.document?.filename === 'baseline.md') {
          probe.readyMs = performance.now() - start;
        }
        if (probe.firstViewportMs === null || probe.readyMs === null) requestAnimationFrame(nextFrame);
      }
      requestAnimationFrame(nextFrame);
    }, { capture: true, once: true });
  }, { title, lead });
  await page.locator('#welcome [data-shell-action="open-file"]').click();
  await page.waitForFunction(() => window.__p6Open.firstViewportMs !== null && window.__p6Open.readyMs !== null);
  return page.evaluate(() => window.__p6Open);
}

async function cancelMeasure(app, page, destination) {
  await app.evaluate(({ app, dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    globalThis.__p6Export = {};
    app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
      if (contents.getURL() !== 'documd://export/export.html') return;
      globalThis.__p6Export.workerId = contents.id;
      contents.once('destroyed', () => {
        globalThis.__p6Export.destroyedAt = performance.timeOrigin + performance.now();
      });
      // Suspend at the export entry after the real worker starts; cancellation remains unmodified.
      void contents.executeJavaScript(`window.desktopViewer.exportDocument = () => {
        window.__p6Held = true; return new Promise(() => {});
      }; undefined`).catch(() => {});
    }));
  }, destination);
  await exportFile(page, 'docx');
  let worker;
  const deadline = performance.now() + 15000;
  while (!worker && performance.now() < deadline) {
    worker = await app.evaluate(async ({ webContents }) => {
      const contents = webContents.fromId(globalThis.__p6Export.workerId ?? 0);
      if (!contents || !await contents.executeJavaScript('window.__p6Held === true').catch(() => false)) return null;
      return { id: contents.id, pid: contents.getOSProcessId() };
    });
    if (!worker) await delay(20);
  }
  assert.ok(worker?.pid > 0, 'expected a live export renderer');
  await page.click('#tasks-open');
  await page.evaluate(() => {
    document.getElementById('cancel-export').addEventListener('click', () => {
      const start = performance.now();
      const probe = window.__p6Cancel = { clickedAt: performance.timeOrigin + start, uiMs: null };
      const frame = () => {
        const state = window.desktopApp.state();
        if (!state.exporting && state.task?.state === 'canceled') probe.uiMs = performance.now() - start;
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  });
  await page.click('#cancel-export');
  await page.waitForFunction(() => window.__p6Cancel?.uiMs !== null && Boolean(window.__p6Cancel));
  const ui = await page.evaluate(() => window.__p6Cancel);
  const backend = await app.evaluate(({ webContents }, id) => {
    return { destroyedAt: globalThis.__p6Export.destroyedAt, stillOpen: Boolean(webContents.fromId(id)) };
  }, worker.id);
  assert.equal(backend.stillOpen, false, 'export worker must be destroyed');
  assert.ok(backend.destroyedAt >= ui.clickedAt, 'missing or invalid export teardown timestamp');
  assert.equal(await fs.stat(destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
  const pidDeadline = performance.now() + 5000;
  let rendererExitMs = null;
  while (performance.now() < pidDeadline) {
    try { process.kill(worker.pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      rendererExitMs = performance.timeOrigin + performance.now() - ui.clickedAt;
      break;
    }
    await delay(10);
  }
  return { uiMs: ui.uiMs, workerDestroyedMs: backend.destroyedAt - ui.clickedAt, rendererExitObservedMs: rendererExitMs };
}

async function run(profile, cold, index) {
  const { app, page, startupMs } = await launch(profile);
  try {
    if (!result.environment.appVersion) {
      Object.assign(result.environment, await app.evaluate(({ app, screen }) => {
        const display = screen.getPrimaryDisplay();
        return { appVersion: app.getVersion(), electronVersion: process.versions.electron,
          display: { ...display.size, scaleFactor: display.scaleFactor } };
      }));
    }
    const markdown = await openMeasure(page);
    const cancel = cold ? undefined : await cancelMeasure(app, page, path.join(root, `canceled-${index}.docx`));
    if (cold) {
      await page.locator('.document-tab .tab-close').click();
      await page.waitForFunction(() => !window.desktopApp.state().busy && !window.desktopApp.state().document);
    }
    return { startupMs, markdown, ...(cancel && { cancel }) };
  } finally { await app.close(); }
}

function summarize(pick) {
  const sorted = result.samples.map(pick).filter(value => value !== null).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return { count: sorted.length, medianMs: sorted.length ? (sorted[mid] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null,
    maxMs: sorted.length ? sorted.at(-1) : null };
}

try {
  for (let i = 1; i <= samples; i++) {
    const profile = path.join(root, `profile-${i}`);
    const cold = await run(profile, true, i);
    const warm = await run(profile, false, i);
    result.samples.push({ round: i, cold, warm });
    console.error(`completed performance round ${i}/${samples}`);
  }
  result.summary = {
    freshProfileStartup: summarize(sample => sample.cold.startupMs),
    reusedProfileStartup: summarize(sample => sample.warm.startupMs),
    freshProfileFirstViewport: summarize(sample => sample.cold.markdown.firstViewportMs),
    reusedProfileFirstViewport: summarize(sample => sample.warm.markdown.firstViewportMs),
    freshProfileDocumentReady: summarize(sample => sample.cold.markdown.readyMs),
    reusedProfileDocumentReady: summarize(sample => sample.warm.markdown.readyMs),
    cancelUi: summarize(sample => sample.warm.cancel.uiMs),
    cancelWorkerDestroyed: summarize(sample => sample.warm.cancel.workerDestroyedMs),
    cancelRendererExitObserved: summarize(sample => sample.warm.cancel.rendererExitObservedMs),
  };
  console.log(JSON.stringify(result, null, 2));
} finally { await fs.rm(root, { recursive: true, force: true }); }
