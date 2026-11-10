const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { within } = require('./resource-policy.cjs');
const { encode } = require('./document-files.cjs');
const {validateText,validateFormat}=require('./text-codecs.cjs');
const idFor = source => createHash('sha256').update(process.platform === 'win32' ? source.toLowerCase() : source).digest('hex');
const validPath = value => typeof value === 'string' && value.length <= 32768 && path.isAbsolute(value) && !value.includes('\0');
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validate(record) {
  if(record?.schemaVersion===2 && record.kind==='untitled') {
    if(!validId(record.documentId)||record.source!==null||record.resourceRoot!==null||record.workspaceRoot!==null||record.diskVersion!==null
      ||typeof record.title!=='string'||!/^未命名 [1-9]\d{0,5}\.md$/.test(record.title)
      ||record.format?.bom!==false||record.format?.newline!=='\n'||typeof record.updatedAt!=='string'||!Number.isFinite(Date.parse(record.updatedAt)))throw Error('Invalid untitled recovery draft');
    validateText(record.markdown);validateFormat(record.format);return record;
  }
  if (!record || ![1,3].includes(record.schemaVersion) || !validId(record.documentId) || !validPath(record.source)
    || !/\.(md|markdown)$/i.test(record.source) || !validPath(record.resourceRoot)
    || ![null,record.resourceRoot].includes(record.workspaceRoot) || idFor(record.source) !== record.documentId
    || !validId(record.diskVersion) || !record.format || typeof record.format.bom !== 'boolean'
    || !['\n','\r\n'].includes(record.format.newline) || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) throw Error('Invalid recovery draft');
  const relative = path.relative(record.resourceRoot,record.source);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Invalid recovery scope');
  validateText(record.markdown);validateFormat(record.format);
  const encoded=record.format.encoding&&record.format.encoding!=='utf-8';
  if((record.schemaVersion===3)!==Boolean(encoded)||(record.schemaVersion===3&&record.kind!=='encoded'))throw Error('Invalid encoded recovery draft');
  return record;
}
function createDraftStore(directory, { maxItems = 32, maxBytes = 128 * 1024 * 1024 } = {}) {
  const root = path.resolve(directory); let queue = Promise.resolve();
  async function initialize() { await fs.mkdir(root,{recursive:true}); await within(root,root); }
  function serialized(run) { const pending = queue.then(run); queue = pending.catch(()=>{}); return pending; }
  async function entries() {
    await initialize();
    const names = await fs.readdir(root);
    return names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
  }
  async function read(name) {
    const source = path.join(root,name); await within(root,source);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw Error('Invalid recovery file size or type');
    const file = await fs.open(source,'r'); let bytes;
    try {
      const chunks=[]; let size=0;
      while(size<=64*1024*1024) {
        const chunk=Buffer.alloc(Math.min(65536,64*1024*1024+1-size));
        const {bytesRead}=await file.read(chunk,0,chunk.length,null); if(!bytesRead)break;
        chunks.push(chunk.subarray(0,bytesRead)); size+=bytesRead;
      }
      if(size>64*1024*1024)throw Error('Recovery file is too large');
      bytes=Buffer.concat(chunks,size);
    } finally { await file.close(); }
    const record=validate(JSON.parse(bytes.toString('utf8')));
    if(record.documentId!==name.slice(0,-5))throw Error('Recovery filename does not match identity');
    return record;
  }
  return {
    async list() {
      await queue; const records=[],warnings=[];
      for(const name of await entries()) {
        try { records.push(await read(name)); }
        catch(error) { warnings.push(`草稿 ${name.slice(0,12)} 无法读取，文件已保留（${error.message}）`); }
      }
      records.sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt));
      return {records,warnings};
    },
    async get(id) {
      if(!validId(id))throw Error('Invalid recovery identifier');
      await queue; return read(`${id}.json`);
    },
    put(document) {
      const encoded=!document.untitled&&document.format.encoding&&document.format.encoding!=='utf-8';
      const record=validate({schemaVersion:document.untitled?2:encoded?3:1,...(document.untitled?{kind:'untitled',title:document.title}:encoded?{kind:'encoded'}:{}),documentId:document.documentId,source:document.source,
        resourceRoot:document.resourceRoot,workspaceRoot:document.workspaceId?document.resourceRoot:null,
        markdown:document.markdown,diskVersion:document.diskVersion,format:{...document.format},updatedAt:new Date().toISOString()});
      const bytes=Buffer.from(JSON.stringify(record));
      return serialized(async()=>{
        const names=await entries(); const name=`${record.documentId}.json`; let total=0;
        if(!names.includes(name)&&names.length>=maxItems)throw Error('草稿数量达到上限，请先保存或处理已有草稿');
        for(const existing of names) if(existing!==name) total+=(await fs.lstat(path.join(root,existing))).size;
        if(total+bytes.length>maxBytes)throw Error('草稿暂存空间达到上限，请先保存或处理已有草稿');
        const destination=path.join(root,name), temporary=path.join(root,`.${name}.${randomUUID()}.tmp`);
        try {
          const handle=await fs.open(temporary,'wx');
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          await within(root,root);
          try { if(!(await fs.lstat(destination)).isFile())throw Error('Invalid recovery destination'); }
          catch(error) { if(error.code!=='ENOENT')throw error; }
          await fs.rename(temporary,destination);
        } finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
        return {updatedAt:record.updatedAt};
      });
    },
    remove(ids) {
      if(!Array.isArray(ids)||ids.some(id=>!validId(id)))return Promise.reject(Error('Invalid recovery identifier'));
      return serialized(async()=>{await initialize(); for(const id of ids)await fs.rm(path.join(root,`${id}.json`),{force:true});});
    },
    async flush() { await queue; },
  };
}
module.exports={createDraftStore,idFor};
