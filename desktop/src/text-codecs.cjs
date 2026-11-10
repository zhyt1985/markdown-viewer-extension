const iconv = require('iconv-lite');
const MAX_BYTES=10*1024*1024;
const ENCODINGS=[
  {id:'utf-8',name:'UTF-8'},
  {id:'utf-16le',name:'UTF-16 LE'},
  {id:'utf-16be',name:'UTF-16 BE'},
  {id:'gb18030',name:'GB18030'},
  {id:'gbk',name:'GBK / GB2312'},
  {id:'big5',name:'Big5'},
  {id:'shift_jis',name:'Shift JIS'},
  {id:'windows-1252',name:'Windows-1252'},
];
const validEncoding=value=>ENCODINGS.some(item=>item.id===value);
function failure(code,message){const error=Error(message);error.code=code;return error;}
function validateText(value){
  if(typeof value!=='string'||Buffer.byteLength(value)>MAX_BYTES)throw Error('Markdown files must be at most 10 MiB');
}
function validateFormat(format){
  if(!format||typeof format.bom!=='boolean'||!['\n','\r\n'].includes(format.newline)||!validEncoding(format.encoding||'utf-8')
    ||(format.bom&&!['utf-8','utf-16le','utf-16be'].includes(format.encoding||'utf-8')))throw Error('Invalid document encoding format');
}
function decode(bytes,encoding='auto'){
  const bom=bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))?{encoding:'utf-8',size:3}
    :bytes.subarray(0,2).equals(Buffer.from([0xff,0xfe]))?{encoding:'utf-16le',size:2}
    :bytes.subarray(0,2).equals(Buffer.from([0xfe,0xff]))?{encoding:'utf-16be',size:2}:null;
  const selected=encoding==='auto'?(bom?.encoding||'utf-8'):encoding;
  if(!validEncoding(selected))throw Error('Unsupported document encoding');
  if(bom&&bom.encoding!==selected)throw failure('ENCODING_MISMATCH','文件 BOM 与所选编码不符，请选择对应的 Unicode 编码。');
  let markdown;
  try{markdown=new TextDecoder(selected,{fatal:true,ignoreBOM:true}).decode(bytes.subarray(bom?.size||0));}
  catch{throw failure('ENCODING_REQUIRED',`文件无法按 ${selected.toUpperCase()} 完整解码；请使用“按编码打开”选择正确编码。`);}
  if(markdown.includes('\0'))throw failure('ENCODING_REQUIRED','解码结果含空字符，请选择正确的文本编码。');
  validateText(markdown);
  return {markdown,format:{bom:Boolean(bom),newline:markdown.includes('\r\n')?'\r\n':'\n',encoding:selected}};
}
function encode(markdown,format){
  validateText(markdown);validateFormat(format);
  const selected=format.encoding||'utf-8',text=markdown.replace(/\r\n?/g,'\n').replace(/\n/g,format.newline);
  const body=iconv.encode(text,selected);
  let decoded;try{decoded=new TextDecoder(selected,{fatal:true,ignoreBOM:true}).decode(body);}catch{}
  if(decoded!==text)throw failure('UNREPRESENTABLE',`当前 ${selected.toUpperCase()} 编码无法无损保存部分字符，请使用“另存为 UTF-8”。编辑稿已保留。`);
  const marker=format.bom?Buffer.from(selected==='utf-8'?[0xef,0xbb,0xbf]:selected==='utf-16le'?[0xff,0xfe]:[0xfe,0xff]):Buffer.alloc(0);
  const bytes=Buffer.concat([marker,body]);if(bytes.length>MAX_BYTES)throw Error('Markdown files must be at most 10 MiB');return bytes;
}
module.exports={ENCODINGS,validEncoding,decode,encode,validateText,validateFormat};
