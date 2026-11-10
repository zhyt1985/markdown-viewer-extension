const path = require('node:path');
const { createHash } = require('node:crypto');
const {validEncoding}=require('./text-codecs.cjs');

function validPath(value) { return typeof value === 'string' && value.length <= 32768 && path.isAbsolute(value) && !value.includes('\0'); }
function validDocument(item) {
  return item && validPath(item.source) && validPath(item.resourceRoot)
    && (item.workspaceRoot === null || item.workspaceRoot === item.resourceRoot)
    &&(item.encoding===undefined||validEncoding(item.encoding));
}
function createNavigationHistory(state) {
  let recent = [];
  return {
    async load() {
      const stored = await state.get(['desktopSession', 'desktopRecent']);
      const session = stored.desktopSession || { version: 1, workspaces: [], documents: [], activeSource: null };
      const history = stored.desktopRecent || { version: 1, items: [] };
      if (session.version !== 1 || !Array.isArray(session.workspaces) || session.workspaces.length > 32
        || !session.workspaces.every(validPath) || !Array.isArray(session.documents) || session.documents.length > 32
        || !session.documents.every(validDocument) || (session.activeSource !== null && !validPath(session.activeSource))
        || history.version !== 1 || !Array.isArray(history.items) || history.items.length > 20 || !history.items.every(validDocument)) {
        throw Error('Invalid saved navigation state');
      }
      if ((session.untitledIds!==undefined&&(!Array.isArray(session.untitledIds)||session.untitledIds.length>32||!session.untitledIds.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id))))
        ||(session.activeDocumentId!==undefined&&session.activeDocumentId!==null&&(typeof session.activeDocumentId!=='string'||!/^[a-f0-9]{64}$/.test(session.activeDocumentId))))throw Error('Invalid saved document identities');
      recent = history.items;
      return session;
    },
    touch(document) {
      if(document.untitled)return;
      const item = { source: document.source, resourceRoot: document.resourceRoot,
        workspaceRoot: document.workspaceId ? document.resourceRoot : null,
        ...(document.format?.encoding||document.encoding?{encoding:document.format?.encoding||document.encoding}:{}) };
      recent = [item, ...recent.filter(entry => entry.source !== item.source)].slice(0, 20);
    },
    list() {
      return recent.map(item => ({ id: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
        filename: path.basename(item.source), documentPath: item.source, workspace: Boolean(item.workspaceRoot) }));
    },
    resolve(id) {
      const index = this.list().findIndex(item => item.id === id);
      if (index < 0) throw Error('Recent document is unavailable');
      return { ...recent[index] };
    },
    clear() { recent = []; },
    async save(session) {
      await state.update('set', { desktopSession: { version: 1, ...session }, desktopRecent: { version: 1, items: recent } });
    },
  };
}
module.exports = { createNavigationHistory };
