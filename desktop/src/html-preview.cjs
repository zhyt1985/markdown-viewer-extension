const path = require('node:path');
const { WebContentsView, session } = require('electron');
const { contains, samePath, resolveResource, validateResource } = require('./resource-policy.cjs');
const { readDocumentBytes } = require('./document-files.cjs');

const assetTypes = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function createHtmlPreview(window, onFailure) {
  const partition = session.fromPartition('documd-html-preview', { cache: false });
  let active = null;
  const matchesHost = (url, record) => url.protocol === 'documd:' && url.hostname === record.host
    && !url.port && !url.username && !url.password;

  partition.setPermissionCheckHandler(() => false);
  partition.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
  partition.on('will-download', event => event.preventDefault());
  partition.webRequest.onBeforeRequest((details, respond) => {
    const record = active;
    const url = new URL(details.url);
    const allowed = record && details.webContentsId === record.view.webContents.id
      && (details.resourceType === 'mainFrame' ? url.href === record.entryUrl
        : matchesHost(url, record) || ['data:', 'blob:'].includes(url.protocol));
    respond({ cancel: !allowed });
  });

  partition.protocol.handle('documd', async request => {
    const record = active;
    const url = new URL(request.url);
    if (!record || request.method !== 'GET' || !matchesHost(url, record)) return new Response('', { status: 403 });
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    };
    const local = `documd://${record.host}`;
    if (url.href === record.entryUrl) {
      return new Response(record.document.markdown, { headers: {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
        'X-DNS-Prefetch-Control': 'off',
        'Connection-Allowlist': '(response-origin);webrtc=block',
        'Content-Security-Policy': [
          "sandbox allow-scripts", "default-src 'none'", "base-uri 'none'", "form-action 'none'",
          "worker-src 'none'", "frame-src 'none'",
          `script-src ${local} 'unsafe-inline'`, `style-src ${local} 'unsafe-inline'`,
          `img-src ${local} data: blob:`, `font-src ${local} data:`, `connect-src ${local}`,
        ].join('; '),
      } });
    }
    try {
      const segments = url.pathname.slice(1).split('/').map(decodeURIComponent);
      if (segments.some(part => !part || part === '.' || part === '..' || /[/\\\0:]/.test(part))) {
        return new Response('', { status: 403 });
      }
      const root = record.document.resourceRoot;
      // Use a common URL base so sibling folders can be addressed with ../.
      // The base itself grants no access, and root-relative primary assets
      // retain their original fallback.
      const candidate = path.resolve(record.mount, ...segments);
      let scope;
      try { scope = await resolveResource(record.document, candidate); }
      catch (error) {
        if (record.mount === root) throw error;
        scope = await resolveResource(record.document, path.resolve(root, ...segments));
      }
      const source = scope.target;
      const extension = path.extname(source).toLowerCase();
      if (!Object.hasOwn(assetTypes, extension)) return new Response('', { status: 403 });
      const { bytes } = await readDocumentBytes(scope.root, source);
      await validateResource(scope);
      if (active !== record) return new Response('', { status: 403 });
      return new Response(bytes, { headers: {
        ...headers, 'Content-Type': assetTypes[extension],
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      } });
    } catch {
      return new Response('', { status: 403 });
    }
  });

  function close() {
    if (!active) return;
    const { view } = active;
    active = null;
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  async function open(document) {
    close();
    const host = `html-${document.token}`;
    let mount = document.resourceRoot;
    for (const extra of document.resourceFolders || []) {
      if (extra.revoked || !samePath(path.parse(mount).root, path.parse(extra.folder).root)) continue;
      while (!contains(mount, extra.folder)) mount = path.dirname(mount);
    }
    const relative = path.relative(mount, document.source).split(path.sep).map(encodeURIComponent).join('/');
    const entryUrl = `documd://${host}/${relative}`;
    const view = new WebContentsView({ webPreferences: {
      session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, navigateOnDragDrop: false, disableDialogs: true,
      spellcheck: false, disableHtmlFullscreenWindowResize: true,
    } });
    const record = { view, host, entryUrl, document, mount, loaded: false, recovering: false };
    active = record;
    const contents = view.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
      contents.on(eventName, event => event.preventDefault());
    }
    const fail = () => {
      if (active !== record) return;
      close();
      onFailure(document);
    };
    contents.on('render-process-gone', fail);
    contents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
      if (!isMainFrame || active !== record || !record.loaded || record.recovering || url === entryUrl) return;
      // Chromium can commit an error page when the network policy rejects a navigation.
      // Restore the authorized page while keeping the URL allowlist in force.
      record.recovering = true;
      void contents.loadURL(entryUrl).then(() => { record.recovering = false; }, fail);
    });
    view.setVisible(false);
    window.contentView.addChildView(view);
    let timer;
    try {
      await Promise.race([
        contents.loadURL(entryUrl),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('HTML preview timed out')), 12000); }),
      ]);
      if (active !== record) throw Error('HTML preview superseded');
      record.loaded = true;
    } catch (error) {
      if (active === record) close();
      throw error;
    } finally { clearTimeout(timer); }
  }

  function resize(document, bounds) {
    if (!active || active.document !== document) return;
    const { view } = active;
    if (!bounds) {
      const focused = view.webContents.isFocused();
      view.setVisible(false);
      if (focused) window.webContents.focus();
      return;
    }
    const { x, y, width, height } = bounds;
    if (![x, y, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0) throw Error('Invalid HTML preview bounds');
    const content = window.getContentBounds();
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(content.width, x + width), bottom = Math.min(content.height, y + height);
    if (right <= left || bottom <= top) { view.setVisible(false); return; }
    view.setBounds({ x: left, y: top, width: right - left, height: bottom - top });
    view.setVisible(true);
  }
  return { open, resize, close };
}

module.exports = { createHtmlPreview };
