const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { contains, samePath, within } = require('./resource-policy.cjs');
const { documentType } = require('./document-types.cjs');
const limit = 20000, pageSize = 500;

function createWorkspaces() {
  const roots = new Map();
  function root(id) {
    const workspace = roots.get(id);
    if (!workspace) throw Error('Workspace is closed or unavailable');
    return workspace;
  }
  function node(workspace, id) {
    const entry = workspace.nodes.get(id);
    if (!entry) throw Error('Unknown workspace entry');
    return entry;
  }
  async function readDirectory(workspace, directory, exact = false) {
    const target = await within(workspace.root, directory);
    if (exact && !samePath(target, directory)) throw Error('Workspace folder was replaced');
    const children = await fs.readdir(target, { withFileTypes: true });
    if (children.length > limit) throw Error('This folder has more than 20000 entries; use workspace search or open a subfolder');
    return children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
      || (a.name < b.name ? -1 : Number(a.name > b.name)));
  }
  function page(workspace, directory, children, offset) {
    const items = children.slice(offset, offset + pageSize).map(child => {
      const source = path.join(directory, child.name);
      let childId = workspace.paths.get(source);
      if (!childId) { childId = randomUUID(); workspace.paths.set(source, childId); }
      const kind = child.isSymbolicLink() ? 'link' : child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other';
      workspace.nodes.set(childId, { path: source, kind });
      return { id: childId, name: child.name, kind, supported: kind === 'file' && Boolean(documentType(child.name)) };
    });
    return { items, total: children.length, previousOffset: offset > 0 ? Math.max(0, offset - pageSize) : null,
      nextOffset: offset + items.length < children.length ? offset + items.length : null };
  }
  return {
    all() { return [...roots.values()].map(item => ({ id: item.id, name: item.name, root: item.root })); },
    describe(id) { const workspace = root(id); return { id, name: workspace.name, root: workspace.root }; },
    async registerFile(id, source) {
      const workspace = root(id);
      source = await within(workspace.root, source);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || !documentType(source)) throw Error('Entry is not a supported document');
      let entryId = workspace.paths.get(source);
      if (!entryId) { entryId = randomUUID(); workspace.paths.set(source, entryId); }
      workspace.nodes.set(entryId, { path: source, kind: 'file' });
      return entryId;
    },
    async add(selected, { exact = false } = {}) {
      const source = await fs.realpath(selected);
      if (exact && !samePath(selected, source)) throw Error('Workspace folder was replaced');
      if (!(await fs.lstat(source)).isDirectory()) throw Error('Choose a local folder');
      let workspace = [...roots.values()].find(item => item.root === source);
      if (!workspace) {
        if (roots.size >= 32) throw Error('At most 32 workspaces can be open');
        workspace = { id: randomUUID(), root: source, name: path.basename(source) || source, nodes: new Map(), paths: new Map() };
        workspace.nodes.set(workspace.id, { path: source, kind: 'directory' });
        workspace.paths.set(source, workspace.id);
        roots.set(workspace.id, workspace);
      }
      return { id: workspace.id, name: workspace.name };
    },
    async list(id, entryId = id, offset = 0) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > limit) throw Error('Invalid directory page');
      const workspace = root(id);
      const directory = node(workspace, entryId);
      if (directory.kind !== 'directory') throw Error('Entry is not a folder');
      return page(workspace, directory.path, await readDirectory(workspace, directory.path), offset);
    },
    async reveal(source) {
      const workspace = [...roots.values()].filter(item => contains(item.root, source) && !samePath(item.root, source))
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (!workspace) return null;
      if (!samePath(await within(workspace.root, source), source)) throw Error('Document path was replaced');
      const parts = path.relative(workspace.root, source).split(path.sep);
      if (parts.length > 64) throw Error('Workspace path is too deeply nested');
      const steps = [];
      let directory = workspace.root, entryId = workspace.id;
      for (const [index, name] of parts.entries()) {
        const children = await readDirectory(workspace, directory, true);
        const target = path.join(directory, name);
        const childIndex = children.findIndex(child => samePath(path.join(directory, child.name), target));
        const child = children[childIndex];
        const last = index === parts.length - 1;
        if (!child || child.isSymbolicLink() || (last ? !child.isFile() : !child.isDirectory())) {
          throw Error('Document is no longer available in the workspace');
        }
        const offset = Math.floor(childIndex / pageSize) * pageSize;
        const listing = page(workspace, directory, children, offset);
        const targetId = listing.items[childIndex - offset].id;
        steps.push({ entryId, offset, targetId, ...listing });
        directory = path.join(directory, child.name);
        entryId = targetId;
      }
      if (!samePath(await within(workspace.root, source), source)) throw Error('Document path was replaced');
      return { workspaceId: workspace.id, steps };
    },
    async file(id, entryId) {
      const workspace = root(id);
      const entry = node(workspace, entryId);
      if (entry.kind !== 'file') throw Error('Entry is not a regular document');
      const source = await within(workspace.root, entry.path);
      return { source, resourceRoot: workspace.root, workspaceId: id };
    },
    async verify(id, source) { return within(root(id).root, source); },
    close(id) { root(id); roots.delete(id); },
  };
}
module.exports = { createWorkspaces };
