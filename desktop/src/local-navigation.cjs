const path=require('node:path');
const {within}=require('./resource-policy.cjs');
function parseLink(href){
  if(typeof href!=='string'||!href||href.length>32768||href.includes('\0'))throw Error('无效的文档链接');
  if(/^[a-z][a-z\d+.-]*:|^[\\/]|\?/.test(href))throw Error('仅支持授权目录内的相对 Markdown 链接');
  const index=href.indexOf('#');
  const name=decodeURIComponent(index<0?href:href.slice(0,index));
  const anchor=decodeURIComponent(index<0?'':href.slice(index+1));
  if(name.includes('\0')||anchor.includes('\0')||anchor.length>1024||/^[a-z][a-z\d+.-]*:|^[\\/]/i.test(name))throw Error('无效的相对路径');
  if(name&&!/\.(md|markdown)$/i.test(name))throw Error('当前链接仅支持 Markdown 文件');
  return {name,anchor};
}
async function resolveLink(document,href){
  const parsed=parseLink(href);
  if(!parsed.name)return {anchor:parsed.anchor,sameDocument:true};
  if(document.untitled)throw Error('请先保存未命名文档，再打开相对链接');
  const requested=path.resolve(document.directory,parsed.name.replace(/\\/g,path.sep));
  const source=await within(document.resourceRoot,requested);
  return {source,anchor:parsed.anchor};
}
module.exports={parseLink,resolveLink};
