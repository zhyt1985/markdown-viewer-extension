const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { within } = require('./resource-policy.cjs');
const { createStateStore } = require('./state-store.cjs');
const { WindowWorker } = require('./window-worker.cjs');
const { createDiskCache } = require('./disk-cache.cjs');
const { createAppServices } = require('./app-services.cjs');
const { createWorkspaces } = require('./workspaces.cjs');
const { createNavigationHistory } = require('./navigation-history.cjs');
const { searchWorkspace } = require('./workspace-search.cjs');
const { readDocument, readDocumentVersion, writeDocument, encode } = require('./document-files.cjs');
const {ENCODINGS,validEncoding,validateText}=require('./text-codecs.cjs');
const { createDocumentMonitor } = require('./document-monitor.cjs');
const { migrateProfile } = require('./profile-migration.cjs');
const { createDraftStore } = require('./draft-store.cjs');
const { launchPaths, localPath, createOpenInbox } = require('./open-inbox.cjs');
const { resolveLink } = require('./local-navigation.cjs');
const manifest = require('./app-manifest.json');
const readingFontDefaults = require('./reading-font-defaults.json');
function validReadingFont(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===5&&Object.keys(readingFontDefaults).every(key=>Object.hasOwn(value,key))
    &&['latin','cjk','mono'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=100&&/^[\p{L}\p{N} ._()+-]+$/u.test(value[key]))
    &&Number.isInteger(value.size)&&value.size>=12&&value.size<=28
    &&typeof value.lineHeight==='number'&&Number.isFinite(value.lineHeight)&&value.lineHeight>=1.3&&value.lineHeight<=2.4;
}
app.setName(manifest.productName);
if (process.platform === 'win32') app.setAppUserModelId(manifest.appId);
// Explicit profiles (including tests) remain isolated and never import user data.
const explicitProfile = app.commandLine.hasSwitch('user-data-dir');
if (!explicitProfile) {
  const directory = path.join(app.getPath('appData'), manifest.dataDirectory);
  require('node:fs').mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

const APP_URL = 'documd://viewer/index.html';
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
let window;
let current;
let encodingSelection=null;
let opening = false;
let checkingClose = false;
const openInbox = createOpenInbox();
function notifyOpens() {
  if(window&&!window.isDestroyed()&&openInbox.size)window.webContents.send('desktop:external-open');
}
function receiveOpen(paths,cwd,origin) {
  try {if(paths.length)openInbox.push(paths,cwd,origin);}
  catch(error){openInbox.warn(error.message);}
  if(window&&!window.isDestroyed()) {
    if(window.isMinimized())window.restore();window.show();window.focus();
    window.webContents.send('desktop:external-open');
  }
}
const initialOpen={version:1,paths:launchPaths(process.argv,!app.isPackaged),cwd:process.cwd()};
const ownsInstance=app.requestSingleInstanceLock(initialOpen);
if(!ownsInstance)app.quit();
else {
  receiveOpen(initialOpen.paths,initialOpen.cwd,'startup');
  app.on('second-instance',(_event,argv,cwd,data)=>{
    const paths=data?.version===1&&Array.isArray(data.paths)?data.paths:launchPaths(argv,!app.isPackaged);
    receiveOpen(paths,typeof data?.cwd==='string'?data.cwd:cwd,'system');
  });
  app.on('open-file',(event,file)=>{event.preventDefault();receiveOpen([file],process.cwd(),'system');});
}
const grants = new Map();
const sourcePaths = new Set();
const documentIds = new Set();
const documents = new Map();
const workspaces = createWorkspaces();
let exportTask = null;
let diagramWorker;
let navigation;
let searchJob;
let monitor;
let drafts;
const restoreWarnings = [];

function sessionSnapshot() {
  return { workspaces: workspaces.all().map(item => item.root),
    documents: [...documents.values()].filter(item=>!item.untitled).map(item => ({ source: item.source, resourceRoot: item.resourceRoot,
      workspaceRoot: item.workspaceId ? item.resourceRoot : null,
      ...(item.format?.encoding||item.encoding?{encoding:item.format?.encoding||item.encoding}:{}) })), activeSource: current?.source || null,
    untitledIds:[...documents.values()].filter(item=>item.untitled).map(item=>item.documentId),activeDocumentId:current?.documentId||null };
}
async function saveSession(result) {
  try { await navigation.save(sessionSnapshot()); }
  catch (error) {
    if (result && typeof result === 'object') result.persistenceWarning = `会话保存失败：${error.message}`;
    else console.error('Session save failed', error);
  }
  return result;
}
async function restoreScope(item) {
  await within(item.resourceRoot, item.source);
  if (!item.workspaceRoot) return { resourceRoot: item.resourceRoot };
  await within(item.workspaceRoot, item.workspaceRoot);
  const workspace = await workspaces.add(item.workspaceRoot);
  return { resourceRoot: item.workspaceRoot, workspaceId: workspace.id };
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'documd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

async function serve(request) {
  try {
    const url = new URL(request.url);
    if (!['viewer', 'render', 'export'].includes(url.hostname) || request.method !== 'GET') return new Response('', { status: 403 });
    let target;
    if (url.pathname.startsWith('/document/')) {
      const [, , token, ...segments] = url.pathname.split('/');
      const grant = grants.get(token);
      if (!grant) return new Response('', { status: 403 });
      const relative = segments.map(decodeURIComponent).join('/');
      target = await within(grant, path.resolve(grant, relative));
    } else if (url.pathname === '/read-file') {
      const grant = grants.get(url.searchParams.get('token'));
      if (!grant) return new Response('', { status: 403 });
      let requested = url.searchParams.get('path') || '';
      if (requested.startsWith('file:')) requested = fileURLToPath(requested);
      target = await within(grant, path.resolve(grant, requested));
    } else {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      // Expose only UI and bundled public assets, never main/preload/package sources.
      if (!['index.html', 'renderer.js', 'shell.js', 'desktop.css', 'render-host.html', 'export.html'].includes(relative) && !relative.startsWith('assets/')) {
        return new Response('', { status: 403 });
      }
      const base = relative.startsWith('assets/') ? path.join(__dirname, 'assets') : __dirname;
      target = await within(base, path.resolve(__dirname, relative));
    }
    const bytes = await fs.readFile(target);
    return new Response(bytes, { headers: {
      'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    } });
  } catch {
    return new Response('Resource unavailable', { status: 403 });
  }
}

function assertSender(event) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== APP_URL) throw new Error('Untrusted IPC sender');
}

function createHiddenWindow(url, preload) {
  const worker = new BrowserWindow({ width: 1180, height: 860, show: false,
    webPreferences: { ...(preload ? { preload: path.join(__dirname, preload) } : {}),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false },
  });
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  worker.webContents.on('will-navigate', event => event.preventDefault());
  worker.webContents.on('will-attach-webview', event => event.preventDefault());
  worker.ready = worker.loadURL(url);
  return worker;
}

function descriptor(document, token = document.token) {
  const relative = document.untitled?'':path.relative(document.resourceRoot, document.directory).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/');
  return { markdown: document.markdown, filename: document.untitled?document.title:path.basename(document.source),untitled:Boolean(document.untitled),
    documentPath: document.source||'', documentDir: document.directory||'',
    documentId: document.documentId, documentVersion: document.documentVersion,
    revision: document.revision, dirty: Boolean(document.dirty), external: Boolean(document.external),
    recovered: Boolean(document.recovered), draftSavedAt: document.draftSavedAt || null, draftError: document.draftError || null,
    encoding:document.format?.encoding||document.encoding||'utf-8',encodingWarning:document.encodingWarning||null,
    documentBaseUrl: `documd://viewer/document/${token}${relative ? '/' + relative : ''}`,
    fileReadUrl: `documd://viewer/read-file?token=${token}`, resourceBaseUrl: 'documd://viewer/assets/' };
}

function tabs() {
  return [...documents].map(([documentId, document]) => ({ documentId, filename: document.untitled?document.title:path.basename(document.source),untitled:Boolean(document.untitled),
    documentPath: document.source||'', workspaceId: document.workspaceId || null, dirty: Boolean(document.dirty), external: Boolean(document.external) }));
}
async function prepareDocument(source, scope = {}) {
  const requested = path.resolve(source);
  source = await fs.realpath(source);
  if (scope.documentId && (process.platform === 'win32' ? requested.toLowerCase() !== source.toLowerCase() : requested !== source)) throw Error('Source path was replaced');
  if (scope.resourceRoot) source = await within(scope.resourceRoot, source);
  if (!/\.(md|markdown)$/i.test(source)) throw Error('Choose a Markdown file');
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw Error('Markdown files must be at most 10 MiB');
  if (scope.workspaceId) await workspaces.verify(scope.workspaceId, source);
  return { source, directory: path.dirname(source), resourceRoot: scope.resourceRoot || path.dirname(source), workspaceId: scope.workspaceId,
    documentId: createHash('sha256').update(process.platform === 'win32' ? source.toLowerCase() : source).digest('hex'),
    ...(scope.encoding||scope.format?.encoding?{encoding:scope.encoding||scope.format.encoding}:{}) };
}
async function activateDocument(document, remember = true, discard = false) {
  const existing = documents.get(document.documentId);
  if (document.workspaceId) {
    if (existing?.dirty && !discard) workspaces.describe(document.workspaceId);
    else await workspaces.verify(document.workspaceId, document.source);
  }
  let checked, content;
  if(existing?.untitled) {checked=existing;content=existing;}
  else if (existing?.dirty && !discard) {
    checked = existing;
    try { const disk = await readDocumentVersion(existing.resourceRoot, existing.source); existing.external = disk.diskVersion !== existing.diskVersion; }
    catch { existing.external = true; }
    content = existing;
  } else {
    checked = await prepareDocument(document.source, document);
    content = { ...await readDocument(checked.resourceRoot, checked.source,document.encoding||existing?.format?.encoding||'auto'), dirty: false, external: false, revision: (existing?.revision || 0) + 1 };
  }
  diagramWorker.cancelOwner(window.webContents.id, 'Document changed');
  if (current) grants.delete(current.token);
  current = { ...checked, ...content, token: randomUUID(), documentVersion: createHash('sha256').update(content.markdown).digest('hex') };
  if(!current.untitled)sourcePaths.add(current.source.toLowerCase()); documentIds.add(current.documentId);
  documents.set(current.documentId, current);
  if(!current.untitled)monitor?.watch(current);
  if (remember) navigation.touch(checked);
  if(!current.untitled)grants.set(current.token, current.resourceRoot);
  return { ...descriptor(current), tabs: tabs() };
}
function closeDocument(id) {
  if (!documents.has(id)) throw Error('Document is not open');
  documents.delete(id); documentIds.delete(id);
  monitor?.unwatch(id);
  if (current?.documentId === id) {
    diagramWorker.cancelOwner(window.webContents.id, 'Document closed');
    grants.delete(current.token); current = null;
  }
}

async function confirmDiscard(ids) {
  const dirty = ids.filter(id => documents.get(id)?.dirty);
  if (!dirty.length) return true;
  const result = await dialog.showMessageBox(window, { type: 'warning', title: '未保存的修改',
    message: `${dirty.length} 个文档有未保存的修改。确定放弃这些修改？`,
    detail: dirty.map(id=>{const item=documents.get(id);return item.untitled?item.title:path.basename(item.source);}).join('\n')+'\n\n取消后可使用“保存”或“另存为”保留编辑内容。', buttons: ['取消', '放弃修改'], defaultId: 0, cancelId: 0, noLink: true });
  return result.response === 1;
}

function cancelExport() {
  if (!exportTask || exportTask.committing) return false;
  exportTask.canceled = true;
  exportTask.abort(new Error('Export canceled'));
  if (exportTask.worker && !exportTask.worker.isDestroyed()) {
    diagramWorker.cancelOwner(exportTask.worker.webContents.id);
    exportTask.worker.destroy();
  }
  return true;
}

if(ownsInstance)app.whenReady().then(async () => {
  if (!explicitProfile) {
    const migrated = await migrateProfile(app.getPath('userData'), ['documd-desktop-prototype', 'docu.md Desktop Prototype'].map(name => path.join(app.getPath('appData'), name)));
    if (migrated.status === 'warning') restoreWarnings.push(migrated.message);
    if (migrated.status === 'imported') restoreWarnings.push('已导入原型的设置、会话和阅读记录；旧数据目录保留。');
  }
  const stateStore = createStateStore(app.getPath('userData'));
  drafts = createDraftStore(path.join(app.getPath('userData'), 'drafts'));
  navigation = createNavigationHistory(stateStore);
  const cacheVersion = createHash('sha256').update(await fs.readFile(path.join(__dirname, 'assets/render-host.js')))
    .update(await fs.readFile(path.join(__dirname, 'assets/styles.css'))).update(process.versions.electron).digest('hex');
  const diskCache = createDiskCache(path.join(app.getPath('userData'), 'cache/render'), cacheVersion);
  const services = createAppServices(stateStore, diskCache, id => documentIds.has(id), message => {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:service-event', message);
  }, { schema: require('./settings-schema.json').settings,
    locales: require('./assets/_locales/registry.json').locales.map(item => item.code) });
  protocol.handle('documd', serve);
  const localFontAccess=(contents,permission)=>permission==='local-fonts'&&contents===window?.webContents&&contents.getURL()===APP_URL;
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(localFontAccess(contents,permission)));
  session.defaultSession.setPermissionCheckHandler((contents,permission)=>localFontAccess(contents,permission));
  // Desktop runs offline, including its bundled diagram engines.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['documd:', 'data:', 'blob:', 'devtools:'].includes(new URL(details.url).protocol) });
  });
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 640, show: false, title: `${manifest.productName} · ${manifest.version}`,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.removeMenu();
  let closing = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (checkingClose) return;
    checkingClose = true;
    void (async () => {
      let timer;
      try {
        await Promise.race([
          window.webContents.executeJavaScript('(async () => { await window.desktopEditor?.flush(); await window.desktopViewer?.saveReadingState(); })()'),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Editor did not finish; close canceled')), 5000); }),
        ]);
        if (opening) return;
        const dirty = [...documents.values()].filter(item => item.dirty);
        if (dirty.length) {
          const { response } = await dialog.showMessageBox(window, { type: 'warning', title: '未保存的修改',
            message: `${dirty.length} 个文档尚未保存到源文件`, detail: '保留草稿后，下次启动会恢复编辑内容；源文件保持当前磁盘版本。',
            buttons: ['取消', '保留草稿并关闭', '放弃修改并关闭'], defaultId: 0, cancelId: 0, noLink: true });
          if (response === 0) return;
          if (response === 1) { for (const item of dirty) await drafts.put(item); }
          else if (response === 2) {
            await drafts.remove(dirty.map(item => item.documentId));
            await stateStore.update('remove',dirty.filter(item=>item.untitled).map(item=>`reading:${item.documentId}`));
          }
          else return;
        }
        await drafts.flush();
        await navigation.save(sessionSnapshot());
        closing = true; if (!window.isDestroyed()) window.close();
      } catch (error) { console.error('Close canceled', error); }
      finally { clearTimeout(timer); checkingClose = false; notifyOpens(); }
    })();
  });
  ipcMain.handle('desktop:service', (event, envelope) => { assertSender(event); return services(envelope); });
  diagramWorker = new WindowWorker(() => createHiddenWindow('documd://render/render-host.html'));
  monitor = createDocumentMonitor(change => {
    const document = documents.get(change.documentId);
    if (!document) return;
    document.external = true;
    if (!window.isDestroyed()) window.webContents.send('desktop:file-change', change);
  });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { diagramWorker.cancelOwner(window.webContents.id); cancelExport(); }
  });
  window.on('closed', () => { monitor.dispose(); searchJob?.controller.abort(); cancelExport(); diagramWorker.dispose(); });

  try {
    const saved = await navigation.load();
    const availableRoots = new Set();
    for (const root of saved.workspaces) {
      try { await within(root, root); await workspaces.add(root); availableRoots.add(root); }
      catch (error) { restoreWarnings.push(`工作区未恢复：${root}（${error.message}）`); }
    }
    for (const item of saved.documents) {
      try {
        if (item.workspaceRoot && !availableRoots.has(item.workspaceRoot)) throw Error('Workspace unavailable');
        const document = await prepareDocument(item.source, {...await restoreScope(item),encoding:item.encoding});
        documents.set(document.documentId, document); documentIds.add(document.documentId); sourcePaths.add(document.source.toLowerCase());
      } catch (error) { restoreWarnings.push(`文档未恢复：${item.source}（${error.message}）`); }
    }
    await restoreDrafts();
    const active = documents.get(saved.activeDocumentId)||[...documents.values()].find(item => item.source && item.source === saved.activeSource) || [...documents.values()].at(-1);
    if (active) {
      try { await activateDocument(active, false); } catch (error) { restoreWarnings.push(`活动文档未加载：${error.message}`); }
    }
  } catch (error) {
    restoreWarnings.push(`会话未恢复：${error.message}`);
    await restoreDrafts();
    const active = [...documents.values()].at(-1);
    if (active) await activateDocument(active, false).catch(error => restoreWarnings.push(error.message));
  }
  async function restoreDrafts() {
    try {
      const recovered = await drafts.list(); restoreWarnings.push(...recovered.warnings);
      for (const record of recovered.records) {
        try {
          const untitled=record.kind==='untitled'&&record.schemaVersion===2;
          let disk;
          if(!untitled)try { disk = await readDocumentVersion(record.resourceRoot, record.source); } catch {}
          let draftVersion=null,encodingWarning=null;
          try{draftVersion=createHash('sha256').update(encode(record.markdown,record.format)).digest('hex');}
          catch(error){if(error.code!=='UNREPRESENTABLE')throw error;encodingWarning=error.message;}
          if (disk?.diskVersion === draftVersion) { await drafts.remove([record.documentId]); continue; }
          let workspaceId;
          if (record.workspaceRoot) {
            try { await within(record.workspaceRoot, record.workspaceRoot); workspaceId = (await workspaces.add(record.workspaceRoot)).id; } catch {}
          }
          if (!documents.has(record.documentId) && documents.size >= 32) {
            const clean = [...documents.values()].find(item => !item.dirty);
            if (!clean) throw Error('恢复标签已达 32 个，请处理已恢复文档后重启；此草稿仍在本机保留');
            closeDocument(clean.documentId);
            restoreWarnings.push(`为优先恢复草稿，已保存标签未恢复：${clean.source||clean.title}`);
          }
          // A missing source or root never prevents recovery of the stored text.
          documents.set(record.documentId, { ...record, untitled, encodingWarning,directory: untitled?null:path.dirname(record.source), workspaceId,
            dirty: untitled?Boolean(record.markdown.length):true, external: untitled?false:!disk || disk.diskVersion !== record.diskVersion, revision: 1,
            recovered: true, draftSavedAt: record.updatedAt,
            documentVersion: createHash('sha256').update(record.markdown).digest('hex') });
          documentIds.add(record.documentId); if(!untitled)sourcePaths.add(record.source.toLowerCase());
        } catch (error) { restoreWarnings.push(`草稿已保留但未加载：${record.source}（${error.message}）`); }
      }
    } catch (error) { restoreWarnings.push(`草稿恢复失败：${error.message}`); }
  }
  ipcMain.handle('desktop:session', event => {
    assertSender(event);
    return { workspaces: workspaces.all().map(({ id, name }) => ({ id, name })), tabs: tabs(),
      selected: current ? { ...descriptor(current), tabs: tabs() } : null, warnings: restoreWarnings };
  });
  ipcMain.handle('desktop:recent-list', event => { assertSender(event); return navigation.list(); });
  ipcMain.handle('desktop:app-info', event => { assertSender(event); return { ...manifest, version: app.getVersion() }; });
  ipcMain.handle('desktop:preferences', async (event, operation, payload) => {
    assertSender(event);
    if (operation === 'set') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length
        || Object.keys(payload).some(key => !['appearance','livePreview','scrollSync','readingFont'].includes(key))
        || (Object.hasOwn(payload,'appearance') && !['light','dark','system'].includes(payload.appearance))
        || ['livePreview','scrollSync'].some(key => Object.hasOwn(payload,key) && typeof payload[key] !== 'boolean')
        || (Object.hasOwn(payload,'readingFont')&&!validReadingFont(payload.readingFont))) throw Error('Invalid shell preferences');
      await stateStore.mutate(values => { values.desktopShellPreferences = { ...values.desktopShellPreferences, ...payload }; });
    } else if (operation !== 'get') throw Error('Invalid shell preference operation');
    const stored = (await stateStore.get(['desktopShellPreferences'])).desktopShellPreferences;
    return { appearance: ['light','dark','system'].includes(stored?.appearance) ? stored.appearance : 'light',
      livePreview: typeof stored?.livePreview === 'boolean' ? stored.livePreview : true,
      scrollSync: typeof stored?.scrollSync === 'boolean' ? stored.scrollSync : true,
      readingFont:validReadingFont(stored?.readingFont)?stored.readingFont:{...readingFontDefaults},readingFontDefaults:{...readingFontDefaults} };
  });
  ipcMain.handle('desktop:cancel-preview', event => {
    assertSender(event); diagramWorker.cancelOwner(window.webContents.id, 'Preview superseded');
  });

  ipcMain.handle('desktop:render', async (event, payload) => {
    const isExport = exportTask?.worker && !exportTask.worker.isDestroyed() && event.sender === exportTask.worker.webContents
      && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === 'documd://export/export.html';
    if (!isExport) assertSender(event);
    const { renderType, input, themeConfig, documentId, documentVersion } = payload || {};
    if (!['mermaid', 'plantuml', 'dot', 'vega', 'vega-lite', 'infographic', 'canvas', 'drawio', 'echarts', 'svg', 'html'].includes(renderType)
      || !['string', 'object'].includes(typeof input) || input === null || JSON.stringify(payload).length > 8 * 1024 * 1024) {
      throw new Error('Invalid render request');
    }
    const expected = isExport ? exportTask.snapshot.documentVersion : current?.documentVersion;
    const expectedId = isExport ? exportTask.snapshot.documentId : current?.documentId;
    if (!expected || expected !== documentVersion || expectedId !== documentId) throw new Error('Stale document render');
    // Only cache pure text diagrams without resource references. Resource-aware
    // engines keep rendering until dependency revision tracking is implemented.
    const cacheable = ['mermaid', 'dot'].includes(renderType) && typeof input === 'string'
      && !/(?:https?:|file:|documd:|data:|href|src|url\(|image)/i.test(input);
    const key = createHash('sha256').update(JSON.stringify([renderType, input, themeConfig, documentVersion])).digest('hex');
    const task = isExport ? exportTask : null;
    const isCurrent = () => isExport ? exportTask === task && !task.canceled && !task.worker.isDestroyed()
      : current?.documentVersion === documentVersion && current?.documentId === documentId;
    const cached = cacheable ? await diskCache.get(key).catch(() => null) : null;
    if (!isCurrent()) throw new Error('Stale document render');
    const result = cached || await diagramWorker.run({ renderType, input, themeConfig }, event.sender.id);
    if (!isCurrent()) throw new Error('Stale document render');
    if (cacheable && !cached && result && result.success !== false && !result.error && (result.base64 || result.svg)) {
      await diskCache.set(key, result, renderType).catch(() => false);
    }
    return result;
  });
  ipcMain.handle('desktop:cancel-export', event => { assertSender(event); return cancelExport(); });

  ipcMain.handle('desktop:state', async (event, request) => {
    assertSender(event);
    const { operation, payload } = request || {};
    if (!['get', 'set', 'remove'].includes(operation)) throw new Error('Unsupported state operation');
    const result = await services({ id: randomUUID(), type: { get: 'STORAGE_GET', set: 'STORAGE_SET', remove: 'STORAGE_REMOVE' }[operation],
      payload: operation === 'set' ? { items: payload } : { keys: payload } });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });

  ipcMain.handle('desktop:open', async (event) => {
    assertSender(event);
    if (opening) throw new Error('Another file operation is in progress');
    opening = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      if (result.filePaths.length > 32) throw Error('At most 32 documents can be open');
      const selected = await Promise.all(result.filePaths.map(source => prepareDocument(source)));
      if (new Set([...documents.keys(), ...selected.map(item => item.documentId)]).size > 32) throw Error('At most 32 documents can be open');
      const active = await activateDocument(selected[0]);
      for (const document of selected) {
        if (!documents.has(document.documentId)) documents.set(document.documentId, document);
        documentIds.add(document.documentId); sourcePaths.add(document.source.toLowerCase());
        navigation.touch(document);
      }
      return await saveSession({ ...active, tabs: tabs() });
    } finally { opening = false; notifyOpens(); }
  });
  async function exclusive(event, action) {
    assertSender(event);
    if (opening) throw Error('Another file operation is in progress');
    opening = true;
    try { return await saveSession(await action()); } finally { opening = false; notifyOpens(); }
  }
  ipcMain.handle('desktop:new',event=>exclusive(event,async()=>{
    if(documents.size>=32)throw Error('At most 32 documents can be open');
    let number=1;while([...documents.values()].some(item=>item.untitled&&item.title===`未命名 ${number}.md`))number++;
    const document={untitled:true,title:`未命名 ${number}.md`,documentId:createHash('sha256').update(`untitled:${randomUUID()}`).digest('hex'),
      source:null,directory:null,resourceRoot:null,workspaceId:null,markdown:'',diskVersion:null,format:{bom:false,newline:'\n'},dirty:false,external:false,revision:1};
    document.draftSavedAt=(await drafts.put(document)).updatedAt;
    documents.set(document.documentId,document);documentIds.add(document.documentId);
    return {...await activateDocument(document,false),created:true};
  }));
  ipcMain.handle('desktop:drop', (event, paths) => {
    assertSender(event);receiveOpen(paths,process.cwd(),'drop');
  });
  ipcMain.handle('desktop:pending-opens', event => {
    assertSender(event);
    return {requests:opening||checkingClose?[]:openInbox.pending(),warnings:openInbox.warnings()};
  });
  ipcMain.handle('desktop:open-pending', (event, id) => {
    assertSender(event);
    if(checkingClose)throw Error('Window close is in progress');
    return exclusive(event,async()=>{
      const incoming=openInbox.take(id),issues=[],files=[],folders=[];
      for(const requested of incoming.paths) {
        try {
          const source=await fs.realpath(localPath(requested,incoming.cwd)),stat=await fs.stat(source);
          if(stat.isDirectory())folders.push(source);
          else if(stat.isFile()&&/\.(md|markdown)$/i.test(source))files.push(source);
          else throw Error('当前仅支持 Markdown 文件和本机文件夹');
        } catch(error){issues.push(`${requested}：${error.message}`);}
      }
      for(const folder of new Set(folders)) {
        try {await workspaces.add(folder);}catch(error){issues.push(`${folder}：${error.message}`);}
      }
      const prepared=new Map();
      for(const source of new Set(files)) {
        try {
          const id=createHash('sha256').update(process.platform==='win32'?source.toLowerCase():source).digest('hex');
          const existing=documents.get(id);
          if(!existing&&documents.size+[...prepared.keys()].filter(key=>!documents.has(key)).length>=32)throw Error('At most 32 documents can be open');
          const workspace=workspaces.all().filter(item=>{
            const relative=path.relative(item.root,source);return relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
          }).sort((a,b)=>b.root.length-a.root.length)[0];
          const checked=existing||await prepareDocument(source,workspace?{resourceRoot:workspace.root,workspaceId:workspace.id}:{});
          if(!existing?.dirty)await readDocument(checked.resourceRoot,checked.source,checked.encoding||existing?.format?.encoding||'auto');
          prepared.set(id,checked);
        } catch(error){issues.push(`${source}：${error.message}`);}
      }
      let selected=null;
      for(const [id,document] of prepared) {
        if(selected)break;
        try {selected=await activateDocument(document);}catch(error){prepared.delete(id);issues.push(`${document.source}：${error.message}`);}
      }
      for(const [id,document] of prepared) {
        if(!documents.has(id))documents.set(id,document);
        documentIds.add(id);sourcePaths.add(document.source.toLowerCase());navigation.touch(document);
      }
      return {selected:selected?{...selected,tabs:tabs()}:null,tabs:tabs(),
        workspaces:workspaces.all().map(({id,name})=>({id,name})),issues};
    });
  });
  ipcMain.handle('desktop:recent-clear', event => exclusive(event, async () => { navigation.clear(); return { cleared: true }; }));
  ipcMain.handle('desktop:recent-open', (event, id) => exclusive(event, async () => {
    const item = navigation.resolve(id);
    const scope = await restoreScope(item);
    const document = await prepareDocument(item.source, scope);
    if (documents.size >= 32 && !documents.has(document.documentId)) throw Error('At most 32 documents can be open');
    return { ...await activateDocument(document), workspaces: workspaces.all().map(({ id, name }) => ({ id, name })) };
  }));
  ipcMain.handle('desktop:activate', (event, id) => exclusive(event, async () => {
    if (!documents.has(id)) throw Error('Document is not open');
    return activateDocument(documents.get(id));
  }));
  ipcMain.handle('desktop:local-link',(event,payload)=>exclusive(event,async()=>{
    if(!current||payload?.documentId!==current.documentId||payload.documentVersion!==current.documentVersion)throw Error('Stale link request');
    let resolved;
    if(payload.summary===true){
      if(current.untitled)throw Error('请先打开本机文档或工作区');
      resolved={source:await within(current.resourceRoot,path.join(current.resourceRoot,'SUMMARY.md')),anchor:''};
    } else if(payload.fromSummary===true){
      if(current.untitled||payload.summaryScope!==createHash('sha256').update(current.resourceRoot).digest('hex'))throw Error('章节目录范围已变化，请刷新目录');
      resolved=await resolveLink({...current,directory:current.resourceRoot},payload.href.startsWith('#')?`SUMMARY.md${payload.href}`:payload.href);
    } else resolved=await resolveLink(current,payload.href);
    if(resolved.sameDocument)return {...descriptor(current),tabs:tabs(),jumpAnchor:resolved.anchor};
    const document=await prepareDocument(resolved.source,{resourceRoot:current.resourceRoot,workspaceId:current.workspaceId});
    if(documents.size>=32&&!documents.has(document.documentId))throw Error('At most 32 documents can be open');
    return {...await activateDocument(document),jumpAnchor:resolved.anchor};
  }));
  ipcMain.handle('desktop:summary-index',async(event,payload)=>{
    assertSender(event);
    const selected=current;
    if(!selected||selected.untitled||payload?.documentId!==selected.documentId)throw Error('请先打开已保存的本机文档');
    const source=await within(selected.resourceRoot,path.join(selected.resourceRoot,'SUMMARY.md'));
    const id=createHash('sha256').update(process.platform==='win32'?source.toLowerCase():source).digest('hex');
    const draft=documents.get(id);
    const markdown=draft?.dirty?draft.markdown:(await readDocument(selected.resourceRoot,source)).markdown;
    if(Buffer.byteLength(markdown)>256*1024)throw Error('SUMMARY 目录超过 256 KiB，请缩小目录');
    if(current?.documentId!==selected.documentId)throw Error('文档已切换，请刷新目录');
    return {markdown,root:selected.resourceRoot,scope:createHash('sha256').update(selected.resourceRoot).digest('hex'),documentId:selected.documentId};
  });
  async function closeTabs(mode,id) {
    if(!['current','others','all'].includes(mode))throw Error('Invalid tab close operation');
    if (!documents.has(id)) throw Error('Document is not open');
    const ids=[...documents.keys()].filter(item=>mode==='all'||(mode==='others'?item!==id:item===id));
    // Confirm the complete set before removing any tab, including clean tabs.
    if (!await confirmDiscard(ids)) return { canceled: true, tabs: tabs(), activeId: current?.documentId || null };
    await drafts.remove(ids);
    const untitled=ids.filter(item=>documents.get(item).untitled).map(item=>`reading:${item}`);
    if(untitled.length)await stateStore.update('remove',untitled);
    for(const item of ids)closeDocument(item);
    return { tabs: tabs(), activeId: current?.documentId || null };
  }
  ipcMain.handle('desktop:close-tab', (event, id) => exclusive(event,()=>closeTabs('current',id)));
  ipcMain.handle('desktop:close-tabs', (event, payload) => exclusive(event,()=>closeTabs(payload?.mode,payload?.documentId)));
  ipcMain.handle('desktop:draft', (event, payload) => exclusive(event, async () => {
    if (!current || payload?.documentId !== current.documentId || payload.revision !== current.revision) throw Error('Stale editor request');
    validateText(payload.markdown);let bytes=null;current.encodingWarning=null;
    try{bytes=encode(payload.markdown,current.format);}catch(error){if(error.code!=='UNREPRESENTABLE')throw error;current.encodingWarning=error.message;}
    current.markdown = payload.markdown;
    current.documentVersion = createHash('sha256').update(payload.markdown).digest('hex');
    current.dirty = current.untitled?Boolean(payload.markdown.length):!bytes||createHash('sha256').update(bytes).digest('hex') !== current.diskVersion;
    current.revision++;
    try {
      if (current.dirty||current.untitled) current.draftSavedAt = (await drafts.put(current)).updatedAt;
      else { await drafts.remove([current.documentId]); current.draftSavedAt = null; }
      current.draftError = null;
    } catch (error) { current.draftError = error.message; }
    diagramWorker.cancelOwner(window.webContents.id, 'Draft changed');
    return { ...descriptor(current), tabs: tabs() };
  }));
  ipcMain.handle('desktop:reload', (event, id) => exclusive(event, async () => {
    if (!documents.has(id)) throw Error('Document is not open');
    if(documents.get(id).untitled)throw Error('未命名文档没有磁盘版本，请先保存');
    if (!await confirmDiscard([id])) return null;
    const selected = await activateDocument(documents.get(id), false, true);
    await drafts.remove([id]);
    return { ...selected, reloaded: true };
  }));
  ipcMain.handle('desktop:save', (event, payload) => exclusive(event, async () => {
    if (!current || payload?.documentId !== current.documentId || payload.revision !== current.revision) throw Error('Stale save request');
    if (typeof payload.saveAs !== 'boolean') throw Error('Invalid save operation');
    if(payload.encoding!==undefined&&(payload.encoding!=='utf-8'||!payload.saveAs))throw Error('Invalid save encoding');
    const source = current;
    const outputFormat=payload.encoding?{...source.format,encoding:'utf-8'}:source.format;
    if (!payload.saveAs&&!source.untitled) {
      const saved = await writeDocument({ root: source.resourceRoot, source: source.source,
        markdown: source.markdown, format: source.format, expectedVersion: source.diskVersion });
      Object.assign(source, saved, { dirty: false, external: false, revision: source.revision + 1,
        documentVersion: createHash('sha256').update(saved.markdown).digest('hex') });
      source.recovered = false; source.draftSavedAt = null; source.draftError = null;
      let persistenceWarning;
      try { await drafts.remove([source.documentId]); } catch (error) { persistenceWarning = `源文件已保存，旧草稿清理失败：${error.message}`; }
      monitor.watch(source);
      return { ...descriptor(source), tabs: tabs(), saved: true, persistenceWarning };
    }
    const result = await dialog.showSaveDialog(window, { defaultPath: source.untitled?path.join(app.getPath('documents'),source.title):path.join(source.directory, `${path.parse(source.source).name}-副本.md`),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (result.canceled || !result.filePath) return null;
    const destination = path.resolve(result.filePath);
    if (!/\.(md|markdown)$/i.test(destination)) throw Error('Choose a Markdown destination');
    const root = await fs.realpath(path.dirname(destination));
    const target = path.join(root, path.basename(destination));
    let expectedVersion = null;
    try {
      const canonical = await fs.realpath(target);
      if (sourcePaths.has(canonical.toLowerCase())) throw Error('Cannot overwrite an opened source; use Save for the current document');
      expectedVersion = (await readDocumentVersion(root, target)).diskVersion;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (sourcePaths.has(target.toLowerCase())) throw Error('Cannot overwrite an opened source');
    await writeDocument({ root, source: target, markdown: source.markdown, format: outputFormat, expectedVersion });
    const replacement = await prepareDocument(target,{encoding:outputFormat.encoding||'utf-8'});
    const selected = await activateDocument(replacement);
    let persistenceWarning;
    try {
      await stateStore.mutate(values=>{
        const oldKey=`reading:${source.documentId}`,newKey=`reading:${replacement.documentId}`;
        if(values[oldKey])values[newKey]={...values[oldKey]};
        if(source.untitled)delete values[oldKey];
      });
    } catch(error){persistenceWarning=`文件已保存，阅读状态迁移失败：${error.message}`;}
    try { await drafts.remove([source.documentId]); } catch (error) { persistenceWarning = `副本已保存，旧草稿清理失败：${error.message}`; }
    closeDocument(source.documentId);
    return { ...selected, tabs: tabs(), saved: true, previousDocumentId:source.documentId, persistenceWarning };
  }));
  ipcMain.handle('desktop:workspace-open', (event) => exclusive(event, async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return workspaces.add(result.filePaths[0]);
  }));
  ipcMain.handle('desktop:workspace-list', (event, payload) => {
    assertSender(event);
    return workspaces.list(payload?.workspaceId, payload?.entryId);
  });
  ipcMain.handle('desktop:workspace-file', (event, payload) => exclusive(event, async () => {
    const file = await workspaces.file(payload?.workspaceId, payload?.entryId);
    const document = await prepareDocument(file.source, file);
    if (documents.size >= 32 && !documents.has(document.documentId)) throw Error('At most 32 documents can be open');
    return activateDocument(document);
  }));
  ipcMain.handle('desktop:workspace-close', (event, id) => exclusive(event, async () => {
    const ids = [...documents.values()].filter(item => item.workspaceId === id).map(item => item.documentId);
    if (!await confirmDiscard(ids)) return { canceled: true, tabs: tabs(), activeId: current?.documentId || null };
    await drafts.remove(ids);
    if (searchJob?.workspaceId === id) searchJob.controller.abort();
    workspaces.close(id);
    for (const [documentId, document] of documents) if (document.workspaceId === id) closeDocument(documentId);
    return { tabs: tabs(), activeId: current?.documentId || null };
  }));
  ipcMain.handle('desktop:search', async (event, payload) => {
    assertSender(event);
    if (typeof payload?.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(payload.id)) throw Error('Invalid search identifier');
    searchJob?.controller.abort();
    const job = { id: payload.id, workspaceId: payload.workspaceId, controller: new AbortController() };
    searchJob = job;
    try { return await searchWorkspace(workspaces, job.workspaceId, payload.query, payload.mode, job.controller.signal); }
    finally { if (searchJob === job) searchJob = null; }
  });
  ipcMain.handle('desktop:search-cancel', (event, id) => {
    assertSender(event);
    if (searchJob?.id === id) searchJob.controller.abort();
  });
  ipcMain.handle('desktop:export', async (event, payload) => {
    assertSender(event);
    if (!current || opening || exportTask) throw new Error('Open a document and finish the current operation first');
    const { format, documentId, documentVersion } = payload || {};
    if (!['docx', 'pdf'].includes(format)) throw new Error('Unsupported export format');
    if (documentId !== current.documentId || documentVersion !== current.documentVersion) throw new Error('Stale export request');
    let abort;
    const aborted = new Promise((_resolve, reject) => { abort = reject; });
    // Attach a handler immediately: cancellation can arrive while the dialog is open.
    aborted.catch(() => {});
    const task = { id: randomUUID(), snapshot: { ...current },
      abort: error => { task.failure = error; abort(error); },
      canceled: false, worker: null, committing: false };
    exportTask = task;
    let timer;
    let temporary;
    const grant = randomUUID();
    if(!task.snapshot.untitled)grants.set(grant, task.snapshot.resourceRoot);
    try {
      const settingsSnapshot = await stateStore.get(['markdownViewerSettings']);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: path.join(task.snapshot.directory||app.getPath('documents'), `${path.parse(task.snapshot.source||task.snapshot.title).name}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (task.canceled || result.canceled || !result.filePath) return { canceled: true, taskId: task.id };
      // The selected source is always read-only, even if chosen in the Save dialog.
      const destination = path.resolve(result.filePath);
      let canonicalDestination = destination;
      try { canonicalDestination = await fs.realpath(destination); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (sourcePaths.has(canonicalDestination.toLowerCase())) {
        throw new Error('Cannot overwrite the source document');
      }
      timer = setTimeout(() => task.abort(new Error('Export timed out')), 120000);
      const worker = createHiddenWindow('documd://export/export.html', 'export-preload.cjs');
      task.worker = worker;
      worker.webContents.once('render-process-gone', () => task.abort(new Error('Export host crashed')));
      worker.once('closed', () => task.abort(new Error('Export host closed')));
      await Promise.race([worker.ready, aborted]);
      const prepared = await Promise.race([
        worker.webContents.executeJavaScript(`window.desktopViewer.exportDocument(${JSON.stringify({
          ...descriptor(task.snapshot, grant), format, settingsSnapshot,
        })})`), aborted,
      ]);
      if (task.canceled) return { canceled: true, taskId: task.id };
      const bytes = format === 'pdf'
        ? await Promise.race([worker.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' }), aborted])
        : Buffer.from(prepared.base64, 'base64');
      temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${task.id}.tmp`);
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      if (task.canceled) return { canceled: true, taskId: task.id };
      if (task.failure) throw task.failure;
      if (sourcePaths.has(canonicalDestination.toLowerCase())) throw new Error('Cannot overwrite the source document');
      task.committing = true;
      clearTimeout(timer);
      await fs.rename(temporary, destination);
      return { path: destination, bytes: bytes.length, taskId: task.id, documentId, documentVersion };
    } catch (error) {
      if (task.canceled) return { canceled: true, taskId: task.id };
      throw error;
    } finally {
      clearTimeout(timer);
      grants.delete(grant);
      if (task.worker && !task.worker.isDestroyed()) {
        diagramWorker.cancelOwner(task.worker.webContents.id);
        task.worker.destroy();
      }
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
      exportTask = null;
    }
  });
  await window.loadURL(APP_URL);
  window.show();
}).catch((error) => { console.error(error); app.exit(1); });

app.on('window-all-closed', () => app.quit());
