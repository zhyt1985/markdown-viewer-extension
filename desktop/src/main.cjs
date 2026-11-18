const { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { within, contains, samePath, resourcePath, resolveResource, validateResource, extraResourceDirectory } = require('./resource-policy.cjs');
const { createStateStore } = require('./state-store.cjs');
const { WindowWorker } = require('./window-worker.cjs');
const { createHtmlPreview } = require('./html-preview.cjs');
const { createDiskCache } = require('./disk-cache.cjs');
const { createAppServices } = require('./app-services.cjs');
const { createWorkspaces } = require('./workspaces.cjs');
const { createNavigationHistory } = require('./navigation-history.cjs');
const { searchWorkspace } = require('./workspace-search.cjs');
const { readDocument, readDocumentBytes, readDocumentVersion, writeDocument, encode } = require('./document-files.cjs');
const { documentExtensions, textDocumentExtensions, documentType, isReadOnly, canRenderDocument } = require('./document-types.cjs');
const { embedVegaData } = require('./vega-data.cjs');
const {ENCODINGS,validEncoding,validateText}=require('./text-codecs.cjs');
const { createDocumentMonitor } = require('./document-monitor.cjs');
const { migrateProfile } = require('./profile-migration.cjs');
const { createDraftStore } = require('./draft-store.cjs');
const { createAnnotationStore, readAnnotationText, writeAnnotationText } = require('./annotation-store.cjs');
const { ANNOTATION_DEFAULTS, validAnnotationPreferences, formatExportText, serializeAnnotations } = require('./annotation-data.cjs');
const { desktopText, desktopFilename, resolveDesktopLocale } = require('./desktop-locale.cjs');
const { launchPaths, localPath, createOpenInbox } = require('./open-inbox.cjs');
const { resolveLink } = require('./local-navigation.cjs');
const { pdfOptions } = require('./pdf-options.cjs');
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
const SLIDEV_SHELL = 'documd://slides/assets/slidev/slidev-shell/index.html';
const SLIDEV_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors documd://viewer documd://export";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const PNG_WIDTH = 1440;
const PNG_HEIGHT_LIMIT = 16000;
const assetExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg', 'application/x-drawio': 'drawio' };
let desktopLocale = 'en';
const ui = (source, ...values) => desktopText(desktopLocale, source, ...values);
const displayUntitled = title => desktopFilename(desktopLocale, title, true);
let window;
let current;
let currentImageBytes = null;
let htmlPreview;
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
const resourceGrant = document => ({ source: document.source, resourceRoot: document.resourceRoot, resourceFolders: [...(document.resourceFolders || [])] });
const sourcePaths = new Set();
const documentIds = new Set();
const documents = new Map();
const workspaces = createWorkspaces();
let exportTask = null;
let pdfPreview = null;
const PDF_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;
let diagramWorker;
let previewRevision = 0;
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
    if (result && typeof result === 'object') result.persistenceWarning = ui("会话保存失败：{0}", error.message);
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

async function serve(request) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'slides') {
      const prefix = '/assets/slidev/';
      if (request.method !== 'GET' || !url.pathname.startsWith(prefix)) return new Response('', { status: 403 });
      const base = path.join(__dirname, 'assets', 'slidev');
      const target = await within(base, path.resolve(base, decodeURIComponent(url.pathname.slice(prefix.length))));
      return new Response(await fs.readFile(target), { headers: {
        'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': SLIDEV_CSP,
        'Access-Control-Allow-Origin': '*',
      } });
    }
    if (!['viewer', 'render', 'export'].includes(url.hostname) || request.method !== 'GET') return new Response('', { status: 403 });
    if (url.pathname.startsWith('/image/')) {
      if (url.hostname !== 'viewer' || !currentImageBytes || url.pathname !== `/image/${current?.token}`) {
        return new Response('', { status: 403 });
      }
      return new Response(currentImageBytes, { headers: {
        'Content-Type': current.imageMimeType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      } });
    }
    let target, resolved, grant, token;
    if (url.pathname.startsWith('/document/')) {
      const [, , id, ...segments] = url.pathname.split('/');
      token = id;
      grant = grants.get(token);
      if (!grant) return new Response('', { status: 403 });
      const relative = segments.map(decodeURIComponent).join('/');
      target = await within(grant.resourceRoot, path.resolve(grant.resourceRoot, relative));
      resolved = { root: grant.resourceRoot, target };
    } else if (url.pathname === '/read-file') {
      token = url.searchParams.get('token');
      grant = grants.get(token);
      if (!grant) return new Response('', { status: 403 });
      const relative = url.searchParams.has('relative');
      const requested = url.searchParams.get(relative ? 'relative' : 'path');
      resolved = await resolveResource(grant, resourcePath(grant, requested, relative), url.searchParams.get('slide-image') === '1' ? 'image' : 'asset');
      target = resolved.target;
    } else {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      // Expose only UI and bundled public assets, never main/preload/package sources.
      if (!['index.html', 'renderer.js', 'shell.js', 'desktop.css', 'render-host.html', 'export.html'].includes(relative) && !relative.startsWith('assets/')) {
        return new Response('', { status: 403 });
      }
      const base = relative.startsWith('assets/') ? path.join(__dirname, 'assets') : __dirname;
      target = await within(base, path.resolve(__dirname, relative));
    }
    const mime = types[path.extname(target).toLowerCase()] || 'application/octet-stream';
    let bytes;
    const slideImage = url.searchParams.get('slide-image') === '1';
    if (slideImage || resolved?.extra) {
      const limit = slideImage ? 2 * 1024 * 1024 : MAX_DOCUMENT_BYTES;
      if (!resolved || (slideImage && !mime.startsWith('image/'))) return new Response('', { status: 403 });
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > limit) return new Response('', { status: 413 });
      ({ bytes } = await readDocumentBytes(resolved.root, target));
      if (bytes.length > limit) return new Response('', { status: 413 });
    } else bytes = await fs.readFile(target);
    if (resolved) await validateResource(resolved);
    if (grant && grants.get(token) !== grant) return new Response('', { status: 403 });
    return new Response(bytes, { headers: {
      'Content-Type': mime,
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

function createHiddenWindow(url, preload, offscreen = false) {
  const worker = new BrowserWindow({ width: 1180, height: 860, show: false,
    webPreferences: { ...(preload ? { preload: path.join(__dirname, preload) } : {}),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false, offscreen },
  });
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  worker.webContents.on('will-navigate', event => event.preventDefault());
  worker.webContents.on('will-attach-webview', event => event.preventDefault());
  worker.ready = worker.loadURL(url);
  return worker;
}

async function captureDocumentPng(worker, bounds) {
  const { width, height } = bounds || {};
  if (width !== PNG_WIDTH || !Number.isSafeInteger(height) || height < 1) throw Error('Invalid PNG capture size');
  if (height > PNG_HEIGHT_LIMIT) throw Error(ui('整页 PNG 高度为 {0} 像素，超过 {1} 像素上限。请改用 PDF 或拆分文档。', height, PNG_HEIGHT_LIMIT));
  // Capture the full compositor surface without resizing the native window.
  const { data } = await worker.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) throw Error('PNG capture did not produce the full document');
  return bytes;
}

function descriptor(document, token = document.token) {
  const relative = document.untitled?'':path.relative(document.resourceRoot, document.directory).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/');
  // Saving with the original CRLF format can change the raw version without changing rendered text.
  const annotationVersion = document.markdown.includes('\r')
    ? createHash('sha256').update(document.markdown.replace(/\r\n?/g, '\n')).digest('hex')
    : document.documentVersion;
  return { markdown: document.html ? '' : document.markdown, filename: document.untitled?document.title:path.basename(document.source),untitled:Boolean(document.untitled),
    readOnly: isReadOnly(document),
    sourceLanguage: document.sourceLanguage || null,
    diagramType: document.diagramType || null,
    diagramLanguage: document.diagramLanguage || null,
    imageUrl: document.imageMimeType ? `documd://viewer/image/${token}` : null,
    html: Boolean(document.html),
    slidev: Boolean(document.slidev),
    resourceFolders: (document.resourceFolders || []).map(({ id, folder }) => ({ id, folder })),
    documentPath: document.source||'', documentDir: document.directory||'',
    documentId: document.documentId, documentVersion: document.documentVersion, annotationVersion,
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
  const type = documentType(source);
  if (!type) throw Error(ui("当前版本暂不预览此文件类型"));
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw Error('Document files must be at most 10 MiB');
  if (scope.workspaceId) await workspaces.verify(scope.workspaceId, source);
  return { source, directory: path.dirname(source), resourceRoot: scope.resourceRoot || path.dirname(source), workspaceId: scope.workspaceId,
    ...type, documentId: createHash('sha256').update(process.platform === 'win32' ? source.toLowerCase() : source).digest('hex'),
    ...(scope.encoding||scope.format?.encoding?{encoding:scope.encoding||scope.format.encoding}:{}) };
}
async function activateDocument(document, remember = true, discard = false) {
  const existing = documents.get(document.documentId);
  if (document.workspaceId) {
    if (existing?.dirty && !discard) workspaces.describe(document.workspaceId);
    else await workspaces.verify(document.workspaceId, document.source);
  }
  let checked, content;
  let imageBytes = null;
  if(existing?.untitled) {checked=existing;content=existing;}
  else if (existing?.dirty && !discard) {
    checked = existing;
    try { const disk = await readDocumentVersion(existing.resourceRoot, existing.source); existing.external = disk.diskVersion !== existing.diskVersion; }
    catch { existing.external = true; }
    content = existing;
  } else {
    checked = await prepareDocument(document.source, document);
    if (checked.imageMimeType) {
      const { bytes, ...metadata } = await readDocumentBytes(checked.resourceRoot, checked.source);
      imageBytes = bytes;
      content = { ...metadata, markdown: '' };
    } else {
      content = await readDocument(checked.resourceRoot, checked.source, document.encoding || existing?.format?.encoding || 'auto');
    }
    Object.assign(content, { dirty: false, external: false, revision: (existing?.revision || 0) + 1 });
  }
  diagramWorker.cancelOwner(window.webContents.id, 'Document changed');
  htmlPreview.close();
  if (current) grants.delete(current.token);
  current = { ...checked, ...content, resourceFolders: existing?.resourceFolders || [], token: randomUUID(),
    documentVersion: imageBytes ? content.diskVersion : createHash('sha256').update(content.markdown).digest('hex') };
  currentImageBytes = imageBytes;
  if(!current.untitled)sourcePaths.add(current.source.toLowerCase()); documentIds.add(current.documentId);
  documents.set(current.documentId, current);
  if(!current.untitled)monitor?.watch(current);
  if (remember) navigation.touch(current);
  if(!current.untitled && (!isReadOnly(current) || current.slidev))grants.set(current.token, resourceGrant(current));
  return { ...descriptor(current), tabs: tabs() };
}
function closeDocument(id) {
  if (!documents.has(id)) throw Error('Document is not open');
  revokeResources(documents.get(id).resourceFolders || []);
  documents.delete(id); documentIds.delete(id);
  monitor?.unwatch(id);
  if (current?.documentId === id) {
    diagramWorker.cancelOwner(window.webContents.id, 'Document closed');
    htmlPreview.close();
    grants.delete(current.token); current = null; currentImageBytes = null;
  }
}

function revokeResources(folders) {
  for (const folder of folders) folder.revoked = true;
  if (exportTask?.snapshot.resourceFolders?.some(folder => folder.revoked)) cancelExport();
}

async function confirmDiscard(ids) {
  const dirty = ids.filter(id => documents.get(id)?.dirty);
  if (!dirty.length) return true;
  const result = await dialog.showMessageBox(window, { type: 'warning', title: ui("未保存的修改"),
    message: ui("{0} 个文档有未保存的修改。确定放弃这些修改？", dirty.length),
    detail: dirty.map(id=>{const item=documents.get(id);return item.untitled?displayUntitled(item.title):path.basename(item.source);}).join('\n')+ui("\n\n取消后可使用“保存”或“另存为”保留编辑内容。"), buttons: [ui("取消"), ui("放弃修改")], defaultId: 0, cancelId: 0, noLink: true });
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
  const systemLocale = app.commandLine.getSwitchValue('lang') || app.getLocale();
  desktopLocale = resolveDesktopLocale('auto', systemLocale);
  if (!explicitProfile) {
    const migrated = await migrateProfile(app.getPath('userData'), ['documd-desktop-prototype', 'docu.md Desktop Prototype'].map(name => path.join(app.getPath('appData'), name)));
    if (migrated.status === 'warning') restoreWarnings.push(migrated.message);
    if (migrated.status === 'imported') restoreWarnings.push(ui("已导入原型的设置、会话和阅读记录；旧数据目录保留。"));
  }
  const stateStore = createStateStore(app.getPath('userData'));
  try {
    const stored = await stateStore.get(['markdownViewerSettings']);
    desktopLocale = resolveDesktopLocale(stored.markdownViewerSettings?.preferredLocale, systemLocale);
  } catch { /* Normal settings initialization reports an unreadable profile. */ }
  drafts = createDraftStore(path.join(app.getPath('userData'), 'drafts'));
  const annotations = createAnnotationStore(path.join(app.getPath('userData'), 'annotations'));
  navigation = createNavigationHistory(stateStore);
  const cacheVersion = createHash('sha256').update(await fs.readFile(path.join(__dirname, 'assets/render-host.js')))
    .update(await fs.readFile(path.join(__dirname, 'assets/mermaid-fontawesome.json')))
    .update(await fs.readFile(path.join(__dirname, 'assets/styles.css'))).update(process.versions.electron).digest('hex');
  const diskCache = createDiskCache(path.join(app.getPath('userData'), 'cache/render'), cacheVersion);
  const services = createAppServices(stateStore, diskCache, id => documentIds.has(id), (message, settings) => {
    desktopLocale = resolveDesktopLocale(settings?.preferredLocale, systemLocale);
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
  htmlPreview = createHtmlPreview(window, document => {
    if (current === document && !window.isDestroyed()) {
      window.webContents.send('desktop:html-preview-failed', { documentId: document.documentId, documentVersion: document.documentVersion });
    }
  });
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
          const { response } = await dialog.showMessageBox(window, { type: 'warning', title: ui("未保存的修改"),
            message: ui("{0} 个文档尚未保存到源文件", dirty.length), detail: ui("保留草稿后，下次启动会恢复编辑内容；源文件保持当前磁盘版本。"),
            buttons: [ui("取消"), ui("保留草稿并关闭"), ui("放弃修改并关闭")], defaultId: 0, cancelId: 0, noLink: true });
          if (response === 0) return;
          if (response === 1) { for (const item of dirty) await drafts.put(item); }
          else if (response === 2) {
            await drafts.remove(dirty.map(item => item.documentId));
            const untitled = dirty.filter(item => item.untitled).map(item => item.documentId);
            await stateStore.update('remove', untitled.map(id => `reading:${id}`));
            await annotations.remove(untitled);
          }
          else return;
        }
        await drafts.flush();
        await annotations.flush();
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
    if (isMainFrame) { htmlPreview.close(); diagramWorker.cancelOwner(window.webContents.id); cancelExport(); pdfPreview = null; }
  });
  window.on('closed', () => { htmlPreview.close(); monitor.dispose(); searchJob?.controller.abort(); cancelExport(); diagramWorker.dispose(); });

  try {
    const saved = await navigation.load();
    const availableRoots = new Set();
    for (const root of saved.workspaces) {
      try { await within(root, root); await workspaces.add(root); availableRoots.add(root); }
      catch (error) { restoreWarnings.push(ui("工作区未恢复：{0}（{1}）", root, error.message)); }
    }
    for (const item of saved.documents) {
      try {
        if (item.workspaceRoot && !availableRoots.has(item.workspaceRoot)) throw Error('Workspace unavailable');
        const document = await prepareDocument(item.source, {...await restoreScope(item),encoding:item.encoding});
        documents.set(document.documentId, document); documentIds.add(document.documentId); sourcePaths.add(document.source.toLowerCase());
      } catch (error) { restoreWarnings.push(ui("文档未恢复：{0}（{1}）", item.source, error.message)); }
    }
    await restoreDrafts();
    const active = documents.get(saved.activeDocumentId)||[...documents.values()].find(item => item.source && item.source === saved.activeSource) || [...documents.values()].at(-1);
    if (active) {
      try { await activateDocument(active, false); } catch (error) { restoreWarnings.push(ui("活动文档未加载：{0}", error.message)); }
    }
  } catch (error) {
    restoreWarnings.push(ui("会话未恢复：{0}", error.message));
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
            if (!clean) throw Error(ui("恢复标签已达 32 个，请处理已恢复文档后重启；此草稿仍在本机保留"));
            closeDocument(clean.documentId);
            restoreWarnings.push(ui("为优先恢复草稿，已保存标签未恢复：{0}", clean.source||clean.title));
          }
          // A missing source or root never prevents recovery of the stored text.
          documents.set(record.documentId, { ...record, untitled, encodingWarning,directory: untitled?null:path.dirname(record.source), workspaceId,
            dirty: untitled?Boolean(record.markdown.length):true, external: untitled?false:!disk || disk.diskVersion !== record.diskVersion, revision: 1,
            recovered: true, draftSavedAt: record.updatedAt,
            documentVersion: createHash('sha256').update(record.markdown).digest('hex') });
          documentIds.add(record.documentId); if(!untitled)sourcePaths.add(record.source.toLowerCase());
        } catch (error) { restoreWarnings.push(ui("草稿已保留但未加载：{0}（{1}）", record.source, error.message)); }
      }
    } catch (error) { restoreWarnings.push(ui("草稿恢复失败：{0}", error.message)); }
  }
  ipcMain.handle('desktop:session', event => {
    assertSender(event);
    return { workspaces: workspaces.all().map(({ id, name }) => ({ id, name })), tabs: tabs(),
      selected: current ? { ...descriptor(current), tabs: tabs() } : null, warnings: restoreWarnings };
  });
  ipcMain.handle('desktop:recent-list', event => { assertSender(event); return navigation.list(); });
  const openWorkspaceRoots = () => workspaces.all().map(workspace => workspace.root);
  ipcMain.handle('desktop:recent-workspaces', event => { assertSender(event); return navigation.listWorkspaces(openWorkspaceRoots()); });
  ipcMain.handle('desktop:app-info', event => { assertSender(event); return { ...manifest, version: app.getVersion(), systemLocale }; });
  ipcMain.handle('desktop:html-preview', (event, operation, payload) => {
    assertSender(event);
    if (!current?.html || payload?.documentId !== current.documentId || payload.documentVersion !== current.documentVersion) return;
    if (operation === 'open') return htmlPreview.open(current);
    if (operation === 'resize') return htmlPreview.resize(current, payload.bounds);
    throw Error('Invalid HTML preview operation');
  });
  let slideFullscreen = null;
  let fullscreenQueue = Promise.resolve();
  function setNativeFullscreen(active) {
    if (window.isFullScreen() === active) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const event = active ? 'enter-full-screen' : 'leave-full-screen';
      const cleanup = () => { clearTimeout(timer); window.removeListener(event, complete); };
      const complete = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); reject(Error('Fullscreen transition timed out')); }, 6000);
      window.once(event, complete);
      window.setFullScreen(active);
    });
  }
  ipcMain.handle('desktop:fullscreen', (event, operation) => {
    assertSender(event);
    if (operation === 'get') return window.isFullScreen();
    const pending = fullscreenQueue.then(async () => {
      if (operation === 'slide-enter') {
        if (!current?.slidev) throw Error('No Slidev presentation is open');
        if (slideFullscreen === null) slideFullscreen = window.isFullScreen();
        try { await setNativeFullscreen(true); }
        catch (error) { slideFullscreen = null; throw error; }
      } else if (operation === 'slide-exit') {
        const restore = slideFullscreen;
        slideFullscreen = null;
        if (restore !== null) await setNativeFullscreen(restore);
      } else if (operation === 'toggle') await setNativeFullscreen(!window.isFullScreen());
      else throw Error('Invalid fullscreen operation');
    });
    fullscreenQueue = pending.catch(() => {});
    return pending;
  });
  window.on('enter-full-screen', () => window.webContents.send('desktop:fullscreen-changed', true));
  window.on('leave-full-screen', () => { slideFullscreen = null; window.webContents.send('desktop:fullscreen-changed', false); });
  ipcMain.handle('desktop:preferences', async (event, operation, payload) => {
    assertSender(event);
    if (operation === 'set') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length
        || Object.keys(payload).some(key => !['appearance','livePreview','scrollSync','readingFont','annotations'].includes(key))
        || (Object.hasOwn(payload,'appearance') && !['light','dark','system'].includes(payload.appearance))
        || ['livePreview','scrollSync'].some(key => Object.hasOwn(payload,key) && typeof payload[key] !== 'boolean')
        || (Object.hasOwn(payload,'readingFont')&&!validReadingFont(payload.readingFont))
        || (Object.hasOwn(payload,'annotations')&&!validAnnotationPreferences(payload.annotations))) throw Error('Invalid shell preferences');
      await stateStore.mutate(values => { values.desktopShellPreferences = { ...values.desktopShellPreferences, ...payload }; });
    } else if (operation !== 'get') throw Error('Invalid shell preference operation');
    const stored = (await stateStore.get(['desktopShellPreferences'])).desktopShellPreferences;
    return { appearance: ['light','dark','system'].includes(stored?.appearance) ? stored.appearance : 'light',
      livePreview: typeof stored?.livePreview === 'boolean' ? stored.livePreview : true,
      scrollSync: typeof stored?.scrollSync === 'boolean' ? stored.scrollSync : true,
      readingFont:validReadingFont(stored?.readingFont)?stored.readingFont:{...readingFontDefaults},readingFontDefaults:{...readingFontDefaults},
      annotations: validAnnotationPreferences(stored?.annotations) ? stored.annotations : ANNOTATION_DEFAULTS };
  });
  ipcMain.handle('desktop:annotations', (event, operation, payload) => {
    assertSender(event);
    const selected = current;
    if (!selected || payload?.documentId !== selected.documentId) throw Error(ui("批注文档已切换"));
    if (isReadOnly(selected)) throw Error(ui("此文件以只读方式打开"));
    const id = selected.documentId;
    if (operation === 'get') return annotations.get(id);
    if (opening || checkingClose || payload.documentVersion !== selected.documentVersion) throw Error(ui("请等待当前预览更新后再操作批注"));
    if (operation === 'set') return annotations.set(id, payload.revision, payload.annotations);
    const filename = selected.untitled ? displayUntitled(selected.title) : path.basename(selected.source);
    if (operation === 'copy') return annotations.get(id).then(async ({ annotations }) => {
      const references = annotations.map(item => ({ ...item, startLine: item.startLine + 1, endLine: item.endLine + 1 }));
      const text = formatExportText(references, filename, {
        intro: ui("**{0}** 的批注", filename), noteLabel: ui("备注"),
        colorLabels: { yellow: ui("黄色"), green: ui("绿色"), blue: ui("蓝色"), pink: ui("粉色") },
      });
      if (text) await clipboard.writeText(text);
      return Boolean(text);
    });
    if (operation === 'import') return exclusive(event, async () => {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'], filters: [{ name: ui("批注 JSON"), extensions: ['json'] }],
      });
      return result.canceled || !result.filePaths.length ? null : readAnnotationText(localPath(result.filePaths[0], process.cwd()));
    });
    if (operation === 'export') return exclusive(event, async () => {
      const record = await annotations.get(id);
      if (!record.annotations.length) throw Error(ui("当前文档没有批注"));
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${path.parse(filename).name}.remarks.json`,
        filters: [{ name: ui("批注 JSON"), extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      if (!/\.remarks\.json$/i.test(result.filePath)) throw Error(ui("请选择 .remarks.json 保存位置"));
      const data = serializeAnnotations(record.annotations, filename);
      const anchors = Object.fromEntries(record.annotations.filter(item => item.anchor).map(item => [item.id, item.anchor]));
      await writeAnnotationText(localPath(result.filePath, process.cwd()), JSON.stringify({ ...data, desktopAnchors: anchors }));
      return true;
    });
    throw Error('Unsupported annotation operation');
  });
  ipcMain.handle('desktop:cancel-preview', event => {
    assertSender(event);
    previewRevision++;
    diagramWorker.cancelOwner(window.webContents.id, 'Preview superseded');
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
    if (!isExport && (!canRenderDocument(current) || (current.diagramType && current.diagramType !== renderType))) {
      throw Error(ui("此文件不支持所请求的图表渲染"));
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
    const revision = previewRevision;
    const isCurrent = () => isExport ? exportTask === task && !task.canceled && !task.worker.isDestroyed()
      : previewRevision === revision && current?.documentVersion === documentVersion && current?.documentId === documentId;
    const cacheGeneration = diskCache.generation;
    const cached = cacheable ? await diskCache.get(key).catch(() => null) : null;
    if (!isCurrent()) throw new Error('Stale document render');
    const renderInput = renderType === 'vega' || renderType === 'vega-lite'
      ? await embedVegaData(input, isExport ? task.snapshot : current) : input;
    if (!isCurrent()) throw new Error('Stale document render');
    const result = cached || await diagramWorker.run({ renderType, input: renderInput, themeConfig }, event.sender.id);
    if (!isCurrent()) throw new Error('Stale document render');
    if (cacheable && !cached && result && result.success !== false && !result.error && (result.base64 || result.svg)) {
      await diskCache.set(key, result, renderType, cacheGeneration).catch(() => false);
    }
    return result;
  });
  ipcMain.handle('desktop:cancel-export', event => { assertSender(event); return cancelExport(); });
  ipcMain.handle('desktop:cancel-pdf-preview', (event, requestId) => {
    assertSender(event);
    return Boolean(exportTask?.previewRequest === requestId && exportTask?.previewRequest && cancelExport());
  });

  ipcMain.handle('desktop:state', async (event, request) => {
    assertSender(event);
    const { operation, payload } = request || {};
    if (!['get', 'set', 'remove'].includes(operation)) throw new Error('Unsupported state operation');
    const result = await services({ id: randomUUID(), type: { get: 'STORAGE_GET', set: 'STORAGE_SET', remove: 'STORAGE_REMOVE' }[operation],
      payload: operation === 'set' ? { items: payload } : { keys: payload } });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });

  ipcMain.handle('desktop:encodings', event => {
    assertSender(event);
    return ENCODINGS;
  });
  ipcMain.handle('desktop:open', (event, encoding) => exclusive(event, async () => {
    if (encoding !== undefined && !validEncoding(encoding)) throw Error('Unsupported document encoding');
    const result = await dialog.showOpenDialog(window, {
      properties: encoding ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [{ name: ui("支持的文档"), extensions: encoding ? textDocumentExtensions : documentExtensions }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    if (encoding && result.filePaths.length !== 1) throw Error(ui("按编码打开时请选择一个文件"));
    if (result.filePaths.length > 32) throw Error('At most 32 documents can be open');
    const selected = await Promise.all(result.filePaths.map(source => prepareDocument(source)));
    if (new Set([...documents.keys(), ...selected.map(item => item.documentId)]).size > 32) throw Error('At most 32 documents can be open');
    const first = selected[0];
    if (encoding && first.imageMimeType) throw Error(ui("图片文件不使用文本编码"));
    const existing = documents.get(first.documentId);
    if (encoding && existing?.dirty && (existing.format.encoding || 'utf-8') !== encoding) {
      throw Error(ui("该文件有未保存的修改。请先保存、另存为或关闭该文件，再按其他编码打开。"));
    }
    const active = await activateDocument(encoding ? { ...(existing || first), encoding } : first);
    for (const document of selected.slice(1)) {
      if (!documents.has(document.documentId)) documents.set(document.documentId, document);
      documentIds.add(document.documentId); sourcePaths.add(document.source.toLowerCase());
      navigation.touch(documents.get(document.documentId));
    }
    return { ...active, tabs: tabs() };
  }));
  async function exclusive(event, action) {
    assertSender(event);
    if (opening) throw Error('Another file operation is in progress');
    opening = true;
    try { return await saveSession(await action()); } finally { opening = false; notifyOpens(); }
  }
  function assetSource(event, payload, { includeImages = false, duringExport = false } = {}) {
    assertSender(event);
    const selected = current;
    if (opening || checkingClose || (!duringExport && exportTask) || !selected || (!canRenderDocument(selected) && !(includeImages && selected.imageMimeType))
        || selected.html || selected.slidev || payload?.token !== selected.token
        || payload.documentId !== selected.documentId || payload.documentVersion !== selected.documentVersion) {
      throw Error(ui('请先更新当前文档预览'));
    }
    return selected;
  }
  ipcMain.handle('desktop:copy-code', (event, payload) => {
    assetSource(event, payload, { duringExport: true });
    const { text } = payload;
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw Error(ui('无法复制代码'));
    return clipboard.writeText(text);
  });
  ipcMain.handle('desktop:image-action', async (event, payload) => {
    const selected = assetSource(event, payload, { includeImages: true });
    const { action, format, mime, base64 } = payload;
    const extension = Object.hasOwn(assetExtensions, mime) && assetExtensions[mime];
    const allowedMime = { png: 'image/png', svg: 'image/svg+xml', drawio: 'application/x-drawio' };
    if (!extension || !['copy', 'save'].includes(action) || (action === 'copy' && format !== 'png')
        || (format === 'original' ? !mime.startsWith('image/') : !Object.hasOwn(allowedMime, format) || allowedMime[format] !== mime)) {
      throw Error(ui('该资产不支持所选格式'));
    }
    if (typeof base64 !== 'string' || !base64.length || base64.length > 16 * 1024 * 1024) throw Error(ui('该资产无法读取'));
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw Error(ui('该资产无法读取'));
    if (action === 'copy') {
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw Error(ui('该资产无法读取'));
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 16384 || height > 16384 || width * height > 16 * 1024 * 1024) {
        throw Error(ui('图片尺寸超出剪贴板限制'));
      }
      const image = nativeImage.createFromBuffer(bytes, { scaleFactor: 1 });
      if (image.isEmpty()) throw Error(ui('该资产无法读取'));
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
      return { copied: true };
    }
    return saveAsset(selected, payload.documentVersion, payload.name, extension, bytes);
  });
  ipcMain.handle('desktop:table-action', async (event, payload) => {
    const selected = assetSource(event, payload);
    const { action, html, text, base64 } = payload;
    if (action === 'copy' && typeof html === 'string' && html.startsWith('<table ') && typeof text === 'string') {
      if (Buffer.byteLength(html) + Buffer.byteLength(text) > 12 * 1024 * 1024) throw Error(ui('表格导出超过 12 MiB'));
      await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
      return { copied: true };
    }
    if (action === 'save' && typeof base64 === 'string' && base64.length <= 16 * 1024 * 1024) {
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50) {
        return saveAsset(selected, payload.documentVersion, payload.name, 'xlsx', bytes);
      }
    }
    throw Error(ui('无法导出该表格'));
  });
  async function saveAsset(selected, version, basename, extension, bytes) {
    opening = true;
    let temporary;
    try {
      const name = typeof basename === 'string'
        ? basename.slice(0, 100).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') : '';
      const extensions = extension === 'jpg' ? ['jpg', 'jpeg'] : [extension];
      const result = await dialog.showSaveDialog(window, {
        defaultPath: path.join(selected.directory || app.getPath('documents'), `${name || (extension === 'xlsx' ? 'table' : 'image')}.${extension}`),
        filters: [{ name: extension.toUpperCase(), extensions }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      if (selected !== current || version !== current.documentVersion) throw Error(ui('请先更新当前文档预览'));
      const destination = localPath(result.filePath);
      if (!extensions.includes(path.extname(destination).slice(1).toLowerCase())) throw Error(ui('请选择 {0} 文件名', extensions.map(ext => `.${ext}`).join(' / ')));
      let canonical = destination;
      try { canonical = await fs.realpath(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (sourcePaths.has(destination.toLowerCase()) || sourcePaths.has(canonical.toLowerCase())) throw Error(ui('不能覆盖已打开的源文件'));
      temporary = path.join(path.dirname(destination), `.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      await fs.rename(temporary, destination);
      temporary = undefined;
      return { path: destination };
    } finally {
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
      opening = false;
      notifyOpens();
    }
  }
  async function newDraft(markdown = '') {
    if(documents.size>=32)throw Error('At most 32 documents can be open');
    let number=1;while([...documents.values()].some(item=>item.untitled&&item.title===`未命名 ${number}.md`))number++;
    const document={untitled:true,title:`未命名 ${number}.md`,documentId:createHash('sha256').update(`untitled:${randomUUID()}`).digest('hex'),
      source:null,directory:null,resourceRoot:null,workspaceId:null,markdown,diskVersion:null,format:{bom:false,newline:'\n'},dirty:Boolean(markdown.length),external:false,revision:1};
    document.draftSavedAt=(await drafts.put(document)).updatedAt;
    documents.set(document.documentId,document);documentIds.add(document.documentId);
    return {...await activateDocument(document,false),created:true};
  }
  ipcMain.handle('desktop:new', event => exclusive(event, () => newDraft()));
  ipcMain.handle('desktop:resource-folders', (event, payload) => exclusive(event, async () => {
    const selected = current;
    if (!selected || selected.untitled || (!canRenderDocument(selected) && !selected.html)
        || payload?.documentId !== selected.documentId || payload.documentVersion !== selected.documentVersion) {
      throw Error(ui('请先打开可使用本机资源的文件'));
    }
    const folders = selected.resourceFolders || [];
    if (payload.action === 'add') {
      if (folders.length >= 8) throw Error(ui('每个文档最多授权 8 个额外目录'));
      const result = await dialog.showOpenDialog(window, { title: ui('选择额外本机资源目录'),
        defaultPath: selected.directory, properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths?.length) return null;
      let entry;
      try { entry = await extraResourceDirectory(result.filePaths[0]); }
      catch { throw Error(ui('无法授权此目录，请选择本机磁盘中的具体文件夹')); }
      if (contains(selected.resourceRoot, entry.folder) || folders.some(folder => samePath(folder.folder, entry.folder))) {
        throw Error(ui('此目录已在当前文档的授权范围内'));
      }
      selected.resourceFolders = [...folders, { ...entry, id: randomUUID() }];
    } else if (payload.action === 'remove') {
      const entry = folders.find(folder => folder.id === payload.id);
      if (!entry) return null;
      revokeResources([entry]);
      selected.resourceFolders = folders.filter(folder => folder !== entry);
    } else throw Error('Invalid resource folder operation');
    diagramWorker.cancelOwner(window.webContents.id, 'Resource access changed');
    htmlPreview.close();
    grants.delete(selected.token);
    selected.token = randomUUID();
    if (!isReadOnly(selected) || selected.slidev) grants.set(selected.token, resourceGrant(selected));
    return { ...descriptor(selected), tabs: tabs() };
  }));
  ipcMain.handle('desktop:html-import', async (event, operation, payload) => {
    assertSender(event);
    const selected = current;
    const fromFile = payload?.documentId !== undefined;
    if (fromFile && (!selected?.html || payload.documentId !== selected.documentId || payload.documentVersion !== selected.documentVersion)) {
      throw Error('Stale HTML conversion request');
    }
    if (operation === 'source') {
      let html = selected?.markdown;
      if (!fromFile) {
        const item = (await clipboard.read()).find(item => item.types.includes('text/html'));
        const content = item && await item.getType('text/html');
        if (content?.size > MAX_DOCUMENT_BYTES) throw Error('Document files must be at most 10 MiB');
        html = (content && await content.text()) || (await clipboard.readText()).trim();
      }
      if (!fromFile && !/<[a-z][^>]*>/i.test(html)) throw Error(ui('剪贴板中没有可转换的 HTML'));
      validateText(html);
      return html;
    }
    if (operation === 'image') {
      const source = payload?.source;
      if (!fromFile || typeof source !== 'string' || !source || source.length > 32768 || /^(?:[a-z][a-z\d+.-]*:|[\\/#?])/i.test(source)) return null;
      try {
        const scope = await resolveResource(selected, resourcePath(selected, source), 'image');
        const { target, root } = scope;
        const mime = documentType(target)?.imageMimeType;
        if (!mime) return null;
        const { bytes } = await readDocumentBytes(root, target);
        await validateResource(scope);
        if (selected !== current || bytes.length > Math.floor(MAX_DOCUMENT_BYTES * 0.75) - 64) return null;
        return `data:${mime};base64,${bytes.toString('base64')}`;
      } catch { return null; }
    }
    if (operation === 'draft') {
      validateText(payload?.markdown);
      if (!payload.markdown.trim()) throw Error(ui('HTML 中没有可转换的正文'));
      return exclusive(event, () => newDraft(payload.markdown));
    }
    throw Error('Invalid HTML conversion operation');
  });
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
          else if(stat.isFile()&&documentType(source))files.push(source);
          else throw Error(ui("当前版本暂不预览此文件类型"));
        } catch(error){issues.push(`${requested}：${error.message}`);}
      }
      for(const folder of new Set(folders)) {
        try {await addWorkspace(folder);}catch(error){issues.push(`${folder}：${error.message}`);}
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
          if (checked.imageMimeType) await readDocumentVersion(checked.resourceRoot, checked.source);
          else if (!existing?.dirty) await readDocument(checked.resourceRoot, checked.source, checked.encoding || existing?.format?.encoding || 'auto');
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
        documentIds.add(id);sourcePaths.add(document.source.toLowerCase());navigation.touch(documents.get(id));
      }
      return {selected:selected?{...selected,tabs:tabs()}:null,tabs:tabs(),
        workspaces:workspaces.all().map(({id,name})=>({id,name})),issues};
    });
  });
  ipcMain.handle('desktop:recent-clear', event => exclusive(event, async () => { navigation.clear(); return { cleared: true }; }));
  async function addWorkspace(folder, options) {
    const workspace = await workspaces.add(folder, options);
    navigation.touchWorkspace(workspaces.describe(workspace.id).root);
    return workspace;
  }
  ipcMain.handle('desktop:recent-workspace-open', (event, id) => exclusive(event, async () => {
    const root = navigation.resolveWorkspace(id, openWorkspaceRoots());
    if (!root) throw Error(ui('最近工作区不可用'));
    try { return await addWorkspace(root, { exact: true }); }
    catch (error) { throw Error(ui('无法重新打开工作区 {0}：{1}', path.basename(root) || root, error.message)); }
  }));
  ipcMain.handle('desktop:recent-open', (event, id) => exclusive(event, async () => {
    const item = navigation.resolve(id);
    const scope = await restoreScope(item);
    const document = await prepareDocument(item.source, { ...scope, encoding: item.encoding });
    if (documents.size >= 32 && !documents.has(document.documentId)) throw Error('At most 32 documents can be open');
    return { ...await activateDocument(document), workspaces: workspaces.all().map(({ id, name }) => ({ id, name })) };
  }));
  ipcMain.handle('desktop:activate', (event, id) => exclusive(event, async () => {
    if (!documents.has(id)) throw Error('Document is not open');
    return activateDocument(documents.get(id));
  }));
  ipcMain.handle('desktop:local-link',(event,payload)=>exclusive(event,async()=>{
    if(!current||payload?.documentId!==current.documentId||payload.documentVersion!==current.documentVersion)throw Error('Stale link request');
    if(isReadOnly(current))throw Error(ui("此文件以只读方式打开"));
    let resolved;
    if(payload.summary===true){
      if(current.untitled)throw Error(ui("请先打开本机文档或工作区"));
      resolved={source:await within(current.resourceRoot,path.join(current.resourceRoot,'SUMMARY.md')),anchor:''};
    } else if(payload.fromSummary===true){
      if(current.untitled||payload.summaryScope!==createHash('sha256').update(current.resourceRoot).digest('hex'))throw Error(ui("章节目录范围已变化，请刷新目录"));
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
    if(!selected||selected.untitled||isReadOnly(selected)||payload?.documentId!==selected.documentId)throw Error(ui("请先打开已保存的本机文档"));
    const source=await within(selected.resourceRoot,path.join(selected.resourceRoot,'SUMMARY.md'));
    const id=createHash('sha256').update(process.platform==='win32'?source.toLowerCase():source).digest('hex');
    const draft=documents.get(id);
    const markdown=draft?.dirty?draft.markdown:(await readDocument(selected.resourceRoot,source,draft?.format?.encoding||draft?.encoding)).markdown;
    if(Buffer.byteLength(markdown)>256*1024)throw Error(ui("SUMMARY 目录超过 256 KiB，请缩小目录"));
    if(current?.documentId!==selected.documentId)throw Error(ui("文档已切换，请刷新目录"));
    return {markdown,root:selected.resourceRoot,scope:createHash('sha256').update(selected.resourceRoot).digest('hex'),documentId:selected.documentId};
  });
  async function closeTabs(mode,id) {
    if(!['current','others','all'].includes(mode))throw Error('Invalid tab close operation');
    if (!documents.has(id)) throw Error('Document is not open');
    const ids=[...documents.keys()].filter(item=>mode==='all'||(mode==='others'?item!==id:item===id));
    // Confirm the complete set before removing any tab, including clean tabs.
    if (!await confirmDiscard(ids)) return { canceled: true, tabs: tabs(), activeId: current?.documentId || null };
    await drafts.remove(ids);
    const untitled=ids.filter(item=>documents.get(item).untitled);
    if(untitled.length) {
      await annotations.remove(untitled);
      await stateStore.update('remove',untitled.map(item=>`reading:${item}`));
    }
    for(const item of ids)closeDocument(item);
    return { tabs: tabs(), activeId: current?.documentId || null };
  }
  ipcMain.handle('desktop:close-tab', (event, id) => exclusive(event,()=>closeTabs('current',id)));
  ipcMain.handle('desktop:close-tabs', (event, payload) => exclusive(event,()=>closeTabs(payload?.mode,payload?.documentId)));
  ipcMain.handle('desktop:draft', (event, payload) => exclusive(event, async () => {
    if (!current || payload?.documentId !== current.documentId || payload.revision !== current.revision) throw Error('Stale editor request');
    if (isReadOnly(current)) throw Error(ui("此文件以只读方式打开"));
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
    if(documents.get(id).untitled)throw Error(ui("未命名文档没有磁盘版本，请先保存"));
    if (!await confirmDiscard([id])) return null;
    const selected = await activateDocument(documents.get(id), false, true);
    await drafts.remove([id]);
    return { ...selected, reloaded: true };
  }));
  ipcMain.handle('desktop:save', (event, payload) => exclusive(event, async () => {
    if (!current || payload?.documentId !== current.documentId || payload.revision !== current.revision) throw Error('Stale save request');
    if (isReadOnly(current)) throw Error(ui("此文件以只读方式打开"));
    if (typeof payload.saveAs !== 'boolean') throw Error('Invalid save operation');
    if(payload.encoding!==undefined&&(payload.encoding!=='utf-8'||!payload.saveAs))throw Error('Invalid save encoding');
    const source = current;
    const outputFormat=payload.encoding?{...source.format,encoding:'utf-8'}:source.format;
    if (!payload.saveAs&&!source.untitled) {
      const saved = await writeDocument({ root: source.resourceRoot, source: source.source,
        markdown: source.markdown, format: source.format, expectedVersion: source.diskVersion });
      Object.assign(source, saved, { dirty: false, external: false, revision: source.revision + 1,
        documentVersion: createHash('sha256').update(saved.markdown).digest('hex') });
      source.recovered = false; source.draftSavedAt = null; source.draftError = null; source.encodingWarning = null;
      let persistenceWarning;
      try { await drafts.remove([source.documentId]); } catch (error) { persistenceWarning = ui("源文件已保存，旧草稿清理失败：{0}", error.message); }
      monitor.watch(source);
      return { ...descriptor(source), tabs: tabs(), saved: true, persistenceWarning };
    }
    const result = await dialog.showSaveDialog(window, { defaultPath: source.untitled?path.join(app.getPath('documents'),displayUntitled(source.title)):path.join(source.directory, ui("{0}-副本.md", path.parse(source.source).name)),
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
    } catch(error){persistenceWarning=ui("文件已保存，阅读状态迁移失败：{0}", error.message);}
    try { await annotations.transfer(source.documentId, replacement.documentId, source.untitled); }
    catch(error){persistenceWarning=[persistenceWarning,ui("文件已保存，批注迁移失败：{0}", error.message)].filter(Boolean).join('\n');}
    try { await drafts.remove([source.documentId]); } catch (error) {
      persistenceWarning = [persistenceWarning,ui("副本已保存，旧草稿清理失败：{0}", error.message)].filter(Boolean).join('\n');
    }
    closeDocument(source.documentId);
    return { ...selected, tabs: tabs(), saved: true, previousDocumentId:source.documentId, persistenceWarning };
  }));
  ipcMain.handle('desktop:workspace-open', (event) => exclusive(event, async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return addWorkspace(result.filePaths[0]);
  }));
  ipcMain.handle('desktop:workspace-list', (event, payload) => {
    assertSender(event);
    return workspaces.list(payload?.workspaceId, payload?.entryId, payload?.offset);
  });
  ipcMain.handle('desktop:workspace-reveal', async (event, documentId) => {
    assertSender(event);
    const selected = current;
    if (opening || checkingClose || !selected?.source || selected.documentId !== documentId) throw Error(ui('请先打开已保存的本机文档。'));
    const result = await workspaces.reveal(selected.source);
    if (current !== selected || (result && !workspaces.all().some(workspace => workspace.id === result.workspaceId))) {
      throw Error(ui('定位期间当前文件或工作区已切换'));
    }
    return result;
  });
  ipcMain.handle('desktop:workspace-file', (event, payload) => exclusive(event, async () => {
    const file = await workspaces.file(payload?.workspaceId, payload?.entryId);
    const document = await prepareDocument(file.source, file);
    if (documents.size >= 32 && !documents.has(document.documentId)) throw Error('At most 32 documents can be open');
    return activateDocument(document);
  }));
  ipcMain.handle('desktop:workspace-close', (event, id) => exclusive(event, async () => {
    const { root } = workspaces.describe(id);
    const ids = [...documents.values()].filter(item => item.workspaceId === id).map(item => item.documentId);
    if (!await confirmDiscard(ids)) return { canceled: true, tabs: tabs(), activeId: current?.documentId || null };
    await drafts.remove(ids);
    if (searchJob?.workspaceId === id) searchJob.controller.abort();
    workspaces.close(id);
    navigation.touchWorkspace(root);
    for (const [documentId, document] of documents) if (document.workspaceId === id) closeDocument(documentId);
    return { tabs: tabs(), activeId: current?.documentId || null };
  }));
  ipcMain.handle('desktop:search', async (event, payload) => {
    assertSender(event);
    if (typeof payload?.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(payload.id)) throw Error('Invalid search identifier');
    searchJob?.controller.abort();
    const job = { id: payload.id, workspaceId: payload.workspaceId, controller: new AbortController() };
    searchJob = job;
    try {
      return await searchWorkspace(workspaces, job.workspaceId, payload.query, payload.mode, job.controller.signal, {}, progress => {
        if (searchJob === job && !job.controller.signal.aborted && !event.sender.isDestroyed()) {
          event.sender.send('desktop:search-progress', { id: job.id, ...progress });
        }
      });
    }
    finally { if (searchJob === job) searchJob = null; }
  });
  ipcMain.handle('desktop:search-cancel', (event, id) => {
    assertSender(event);
    if (searchJob?.id === id) searchJob.controller.abort();
  });
  ipcMain.handle('desktop:export', async (event, payload) => {
    assertSender(event);
    if (!current || opening || exportTask) throw new Error('Open a document and finish the current operation first');
    if (!canRenderDocument(current)) throw Error(ui("此文件以只读方式打开"));
    const { format, documentId, documentVersion, previewRequest, previewId } = payload || {};
    if (!['docx', 'pdf', 'html', 'png', 'assets'].includes(format)) throw new Error('Unsupported export format');
    if (current.slidev && format !== 'pdf') throw new Error('Slidev only supports static PDF export');
    if (documentId !== current.documentId || documentVersion !== current.documentVersion) throw new Error('Stale export request');
    const preview = previewRequest !== undefined;
    if ((preview || previewId !== undefined || payload.pdfOptions !== undefined) && format !== 'pdf') throw Error('PDF options require PDF export');
    if (preview && (typeof previewRequest !== 'string' || !/^[a-f0-9-]{36}$/.test(previewRequest) || previewId !== undefined)) throw Error('Invalid PDF preview request');
    if (current.slidev && payload.pdfOptions !== undefined) throw Error('Slidev uses its own paper size');
    const layout = format === 'pdf' && !current.slidev ? pdfOptions(payload.pdfOptions) : null;
    let previewBytes;
    if (previewId !== undefined) {
      if (!pdfPreview || pdfPreview.id !== previewId || pdfPreview.documentId !== documentId
        || pdfPreview.documentVersion !== documentVersion || pdfPreview.layout !== layout?.key) throw Error(ui('分页预览已失效，请重新生成。'));
      previewBytes = pdfPreview.bytes;
    }
    if (format === 'pdf') pdfPreview = null;
    const selection = payload.assets;
    if (format === 'assets' && (!Array.isArray(selection) || !selection.length || selection.length > 500
      || selection.some(item => !item || !Number.isSafeInteger(item.index) || item.index < 1 || item.index > 100000
        || typeof item.key !== 'string' || item.key.length > 3000 || !['original', 'png', 'svg', 'drawio'].includes(item.format))
      || new Set(selection.map(item => item.index)).size !== selection.length)) throw Error(ui('每次可导出 1 至 500 项资产'));
    let abort;
    const aborted = new Promise((_resolve, reject) => { abort = reject; });
    // Attach a handler immediately: cancellation can arrive while the dialog is open.
    aborted.catch(() => {});
    const task = { id: randomUUID(), snapshot: { ...current }, previewRequest,
      abort: error => { task.failure = error; abort(error); },
      canceled: false, worker: null, committing: false };
    exportTask = task;
    let timer;
    let temporary;
    const grant = randomUUID();
    if(!task.snapshot.untitled)grants.set(grant, resourceGrant(task.snapshot));
    try {
      const settingsSnapshot = await stateStore.get(['markdownViewerSettings']);
      const result = preview ? null : format === 'assets' ? await dialog.showOpenDialog(window, {
        title: ui('选择资产导出目录'), defaultPath: task.snapshot.directory || app.getPath('documents'), properties: ['openDirectory'],
      }).then(({ canceled, filePaths }) => ({ canceled, filePath: filePaths[0] })) : await dialog.showSaveDialog(window, {
        defaultPath: path.join(task.snapshot.directory||app.getPath('documents'), `${path.parse(task.snapshot.source||displayUntitled(task.snapshot.title)).name}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (task.canceled || (!preview && (result.canceled || !result.filePath))) return { canceled: true, taskId: task.id };
      // The selected source is always read-only, even if chosen in the Save dialog.
      const destination = preview ? null : path.resolve(result.filePath);
      if (format === 'html' && !/\.html?$/i.test(destination)) throw Error(ui('请选择 .html 或 .htm 文件名'));
      if (format === 'png' && !/\.png$/i.test(destination)) throw Error(ui('请选择 .png 文件名'));
      let canonicalDestination = destination;
      if (destination) try { canonicalDestination = await fs.realpath(destination); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (destination && format !== 'assets' && sourcePaths.has(canonicalDestination.toLowerCase())) {
        throw new Error('Cannot overwrite the source document');
      }
      timer = setTimeout(() => task.abort(new Error('Export timed out')), 120000);
      const commitFile = async bytes => {
        temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${task.id}.tmp`);
        await fs.writeFile(temporary, bytes, { flag: 'wx' });
        if (task.canceled) return { canceled: true, taskId: task.id };
        if (task.failure) throw task.failure;
        if (sourcePaths.has(canonicalDestination.toLowerCase())) throw new Error('Cannot overwrite the source document');
        task.committing = true;
        clearTimeout(timer);
        await fs.rename(temporary, destination);
        return { path: destination, bytes: bytes.length, taskId: task.id, documentId, documentVersion };
      };
      if (previewBytes) return await commitFile(previewBytes);
      const attach = worker => {
        task.worker = worker;
        worker.webContents.once('render-process-gone', () => { if (task.worker === worker) task.abort(new Error('Export host crashed')); });
        worker.once('closed', () => { if (task.worker === worker) task.abort(new Error('Export host closed')); });
        return worker;
      };
      const worker = attach(createHiddenWindow('documd://export/export.html', 'export-preload.cjs', format === 'png'));
      await Promise.race([worker.ready, aborted]);
      if (format === 'png') {
        worker.webContents.debugger.attach('1.3');
        await Promise.race([worker.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: PNG_WIDTH, height: 960, deviceScaleFactor: 1, mobile: false,
        }), aborted]);
        await Promise.race([worker.webContents.debugger.sendCommand('Emulation.setScrollbarsHidden', { hidden: true }), aborted]);
      }
      const prepared = await Promise.race([
        worker.webContents.executeJavaScript(`window.desktopViewer.exportDocument(${JSON.stringify({
          ...descriptor(task.snapshot, grant), format, settingsSnapshot, systemLocale, pdfPageCss: layout?.css,
        })})`), aborted,
      ]);
      if (task.canceled) return { canceled: true, taskId: task.id };
      if (format === 'assets') {
        const directory = await fs.realpath(localPath(result.filePath, process.cwd()));
        temporary = await fs.mkdtemp(path.join(directory, '.documd-assets-'));
        let count = 0, total = 0;
        const byIndex = new Map(prepared.assets.map(({ key, formats, ...asset }) => [asset.index, asset]));
        const failed = new Map([...byIndex].filter(([, asset]) => asset.error));
        const saved = [];
        for (const item of selection) {
          if (task.failure) throw task.failure;
          const meta = byIndex.get(item.index) || { index: item.index };
          let bytes, extension;
          try {
            const data = await Promise.race([worker.webContents.executeJavaScript(
              `window.desktopViewer.readExportAsset(${item.index},${JSON.stringify(item.key)},${JSON.stringify(item.format)})`), aborted]);
            extension = Object.hasOwn(assetExtensions, data.mime) && assetExtensions[data.mime];
            if (!extension || typeof data.base64 !== 'string' || data.base64.length > 16 * 1024 * 1024) throw Error(ui('该资产无法读取'));
            bytes = Buffer.from(data.base64, 'base64');
            if (!bytes.length || total + bytes.length > 128 * 1024 * 1024) throw Error(ui('所选资产超过 128 MiB，请分批导出'));
          } catch (error) {
            if (task.failure) throw task.failure;
            failed.set(item.index, { ...meta, error: error.message.slice(0, 500) });
            continue;
          }
          const type = String(meta.type || 'asset').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'asset';
          const file = `${String(item.index).padStart(3, '0')}-${type}.${extension}`;
          await fs.writeFile(path.join(temporary, file), bytes, { flag: 'wx' });
          saved.push({ ...meta, file });
          failed.delete(item.index);
          total += bytes.length;
          count++;
        }
        const failures = [...failed.values()];
        if (task.failure) throw task.failure;
        if (!count) return { count, failed: failures, taskId: task.id };
        const filename = path.basename(task.snapshot.source || displayUntitled(task.snapshot.title));
        await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ document: filename, saved, failed: failures }, null, 2), { flag: 'wx' });
        if (task.failure) throw task.failure;
        const name = path.parse(filename).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 48).replace(/[ .]+$/, '') || 'document';
        const output = path.join(directory, `${name}-assets-${task.id.slice(0, 8)}`);
        task.committing = true;
        clearTimeout(timer);
        await fs.rename(temporary, output);
        temporary = null;
        return { count, failed: failures, path: output, taskId: task.id };
      }
      if (task.snapshot.slidev) {
        const slideWorker = attach(createHiddenWindow(`${SLIDEV_SHELL}?print=1`));
        worker.destroy();
        await Promise.race([slideWorker.ready, aborted]);
        await Promise.race([slideWorker.webContents.executeJavaScript(`window.desktopSlidevPrint(${JSON.stringify(prepared.slidev)})`), aborted]);
      }
      const bytes = format === 'pdf'
        ? await Promise.race([task.worker.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' }), aborted])
        : format === 'png' ? await Promise.race([captureDocumentPng(worker, prepared.png), aborted])
          : format === 'html' ? Buffer.from(prepared.html, 'utf8') : Buffer.from(prepared.base64, 'base64');
      if (preview) {
        if (task.failure) throw task.failure;
        if (bytes.length > PDF_PREVIEW_MAX_BYTES) throw Error(ui('分页预览超过 32 MiB；仍可直接导出 PDF。'));
        pdfPreview = { id: task.id, documentId, documentVersion, layout: layout?.key, bytes };
        return { id: task.id, data: new Uint8Array(bytes) };
      }
      return await commitFile(bytes);
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
      if (temporary) await fs.rm(temporary, { force: true, recursive: format === 'assets' }).catch(() => {});
      exportTask = null;
    }
  });
  await window.loadURL(APP_URL);
  window.show();
}).catch((error) => { console.error(error); app.exit(1); });

app.on('window-all-closed', () => app.quit());
