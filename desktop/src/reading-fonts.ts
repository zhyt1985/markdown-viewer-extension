import defaults from './reading-font-defaults.json';
export type ReadingFontPreferences = typeof defaults;
const latin='U+0000-024F,U+1E00-1EFF';
const cjk='U+2E80-A4CF,U+F900-FAFF,U+FE10-FE6F,U+FF00-FFEF,U+20000-323AF';
function faces(alias:string,selected:string,fallbacks:string[],range:string) {
  return [400,700].map(weight=>{
    const names=weight===700?[`${selected} Bold`,`${selected} Semibold`,selected,...fallbacks]:[selected,...fallbacks];
    return `@font-face{font-family:"${alias}";font-style:normal;font-weight:${weight};src:${names.map(name=>`local(${JSON.stringify(name)})`).join(',')};unicode-range:${range};font-display:swap;}`;
  }).join('\n');
}
export function readingFontCSS(font:ReadingFontPreferences,scope:string,prefix:string) {
  const prose=`"${prefix}-Latin","${prefix}-CJK","Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`;
  const mono=`"${prefix}-Mono","${prefix}-CJK",Consolas,monospace`;
  return faces(`${prefix}-Latin`,font.latin,['Segoe UI','Arial'],latin)
    +faces(`${prefix}-CJK`,font.cjk,['Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC'],cjk)
    +faces(`${prefix}-Mono`,font.mono,['Consolas','Menlo','DejaVu Sans Mono'],latin)
    +`${scope}{font-family:${prose}!important;font-size:${font.size}px!important;line-height:${font.lineHeight}!important;text-align:start;}
${scope} :is(h1,h2,h3,h4,h5,h6,p,li,blockquote,table,th,td){font-family:${prose}!important;}
${scope} :is(p,li,blockquote){line-height:inherit;}
${scope} :is(h1,h2,h3,h4,h5,h6){font-weight:600;}
${scope} :is(code,pre){font-family:${mono}!important;}`;
}
