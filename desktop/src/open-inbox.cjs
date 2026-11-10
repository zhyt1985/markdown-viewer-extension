const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Startup arguments only open the GUI. No conversion or automation commands.
function launchPaths(argv, development = false) {
  const result=[];
  const valueSwitches=new Set(['--user-data-dir','--inspect','--inspect-brk','--remote-debugging-port','--js-flags','--lang','--log-file']);
  let literal=false,skipApplication=development;
  for(let index=1;index<argv.length;index++) {
    const argument=argv[index];
    if(!literal&&argument==='--'){literal=true;continue;}
    if(!literal&&argument.startsWith('-')){if(valueSwitches.has(argument))index++;continue;}
    if(skipApplication){skipApplication=false;continue;}
    result.push(argument);
    if(result.length>32)break;
  }
  return result;
}
function localPath(value,cwd) {
  if(typeof value!=='string'||!value||value.length>32768||value.includes('\0'))throw Error('无效的本机路径');
  if(/^[a-z][a-z\d+.-]*:/i.test(value)&&! /^[a-z]:[\\/]/i.test(value))throw Error('仅支持本机文件或文件夹，不打开网址');
  if(/^(?:\\\\|\/\/)/.test(value)&&!/^\\\\\?\\[a-z]:\\/i.test(value))throw Error('不支持 UNC 或网络路径');
  return path.resolve(cwd,value);
}
function createOpenInbox(maxRequests=16) {
  const requests=new Map(),warnings=[];
  return {
    push(paths,cwd,origin) {
      if(!Array.isArray(paths)||!paths.length||paths.length>32||paths.some(item=>typeof item!=='string'||item.length>32768||item.includes('\0'))
        ||!path.isAbsolute(cwd)||!['startup','system','drop'].includes(origin))throw Error('每次最多打开 32 个本机文件或文件夹');
      if(requests.size>=maxRequests)throw Error('待打开请求过多，请稍后重试');
      const id=randomUUID();requests.set(id,{id,paths:[...paths],cwd,origin});return id;
    },
    pending(){return [...requests.values()].map(({id,paths,origin})=>({id,count:paths.length,origin}));},
    take(id){const request=requests.get(id);if(!request)throw Error('打开请求已处理或不存在');requests.delete(id);return request;},
    warn(message){warnings.push(String(message).slice(0,1000));if(warnings.length>32)warnings.shift();},
    warnings(){return warnings.splice(0);},
    get size(){return requests.size;},
  };
}
module.exports={launchPaths,localPath,createOpenInbox};
