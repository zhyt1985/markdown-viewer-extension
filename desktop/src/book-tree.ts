import {unified} from 'unified';
import remarkParse from 'remark-parse';
type Node={type:string;value?:string;url?:string;identifier?:string;alt?:string;children?:Node[]};
export type Chapter={label:string;href:string|null;children:Chapter[]};
export function summaryTree(markdown:string){
  if(new TextEncoder().encode(markdown).length>256*1024)throw Error('SUMMARY 目录超过 256 KiB，请缩小目录');
  const tree=unified().use(remarkParse).parse(markdown) as unknown as Node;
  const definitions=new Map<string,string>();let count=0,truncated=false;
  for(const node of tree.children||[])if(node.type==='definition'&&node.identifier&&node.url)definitions.set(node.identifier.toLowerCase(),node.url);
  const text=(node:Node,depth=0):string=>depth>32?'':node.value||node.alt||(node.children||[]).map(child=>text(child,depth+1)).join('');
  const entries=(nodes:Node[],depth=0):Chapter[]=>{
    if(depth>24){truncated=true;return [];}
    const result:Chapter[]=[];
    for(const node of nodes){
      if(count>=500){truncated=true;break;}
      if(node.type==='list'){result.push(...entries(node.children||[],depth+1));continue;}
      if(node.type!=='listItem')continue;
      count++;
      const paragraph=(node.children||[]).find(child=>child.type==='paragraph');
      const link=paragraph?.children?.find(child=>child.type==='link'||child.type==='linkReference');
      const href=link?.url||(link?.identifier?definitions.get(link.identifier.toLowerCase()):undefined);
      result.push({label:(paragraph?text(paragraph):'章节').slice(0,256),href:href||null,children:entries((node.children||[]).filter(child=>child.type==='list'),depth+1)});
    }
    return result;
  };
  return {entries:entries(tree.children||[]),truncated};
}
