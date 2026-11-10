const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { within } = require('./resource-policy.cjs');

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
  return {
    all() { return [...roots.values()].map(item => ({ id: item.id, name: item.name, root: item.root })); },
    describe(id) { const workspace = root(id); return { id, name: workspace.name, root: workspace.root }; },
    async registerFile(id, source) {
      const workspace = root(id);
      source = await within(workspace.root, source);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || !/\.(md|markdown)$/i.test(source)) throw Error('Entry is not a Markdown file');
      let entryId = workspace.paths.get(source);
      if (!entryId) { entryId = randomUUID(); workspace.paths.set(source, entryId); }
      workspace.nodes.set(entryId, { path: source, kind: 'file' });
      return entryId;
    },
    async add(selected) {
      const source = await fs.realpath(selected);
      if (!(await fs.stat(source)).isDirectory()) throw Error('Choose a local folder');
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
    async list(id, entryId = id) {
      const workspace = root(id);
      const directory = node(workspace, entryId);
      if (directory.kind !== 'directory') throw Error('Entry is not a folder');
      const target = await within(workspace.root, directory.path);
      const children = await fs.readdir(target, { withFileTypes: true });
      if (children.length > 2000) throw Error('This folder has more than 2000 entries; choose a smaller folder');
      children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      return children.map(child => {
        const source = path.join(directory.path, child.name);
        let childId = workspace.paths.get(source);
        if (!childId) { childId = randomUUID(); workspace.paths.set(source, childId); }
        const kind = child.isSymbolicLink() ? 'link' : child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other';
        workspace.nodes.set(childId, { path: source, kind });
        return { id: childId, name: child.name, kind, supported: kind === 'file' && /\.(md|markdown)$/i.test(child.name) };
      });
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
