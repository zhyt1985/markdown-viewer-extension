import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, defaultHighlightStyle, HighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

const editable = new Compartment();
const states = new Map<string,{state:EditorState;scrollTop:number}>();
let selected: string | null = null;
let disabled = true, switching = false;
let composing = false;
let documentRevision = 0;
const notify = () => document.dispatchEvent(new Event('desktop:editor-history'));
// Follow the application's color scheme independently of the document theme.
const darkColors:Record<string,string> = {'#404740':'#bac4bd','#708':'#d6a2ed','#219':'#a9b8ff',
  '#164':'#8fd4b0','#a11':'#f3a9a4','#e40':'#ffb17b','#00f':'#a9b8ff','#30a':'#c3b1ff',
  '#085':'#89d6bb','#167':'#8bd1df','#256':'#8bd1df','#00c':'#a9b8ff','#940':'#e0bc88','#f00':'#ff9c9c'};
const highlightStyle=HighlightStyle.define(defaultHighlightStyle.specs.map(spec=>({...spec,
  ...(spec.color?{color:`light-dark(${spec.color}, ${darkColors[String(spec.color)]||'var(--shell-text)'})`}:{})})));
function createState(text:string) {
  return EditorState.create({doc:text,extensions:[
    lineNumbers(),highlightActiveLineGutter(),highlightActiveLine(),drawSelection(),highlightSpecialChars(),
    history({minDepth:100}),foldGutter(),indentOnInput(),bracketMatching(),syntaxHighlighting(highlightStyle),markdown(),
    EditorView.lineWrapping,search({top:true}),highlightSelectionMatches(),
    keymap.of([{key:'Mod-h',run:openSearchPanel},...searchKeymap,...historyKeymap,...defaultKeymap,...foldKeymap,indentWithTab]),
    EditorState.phrases.of({'Find':'查找','Search':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全部',
      'match case':'区分大小写','regexp':'正则表达式','by word':'整词','replace':'替换','replace all':'全部替换','close':'关闭',
      'Fold line':'折叠行','Unfold line':'展开行','to':'到','Go to line':'转到行','go':'前往'}),
    editable.of([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)]),
    EditorView.contentAttributes.of({'aria-label':'Markdown 源码','aria-multiline':'true',spellcheck:'false'}),
    EditorView.updateListener.of(update=>{
      if(update.docChanged)documentRevision++;
      if(!switching&&update.docChanged)document.dispatchEvent(new Event('desktop:editor-input'));
      if(update.docChanged||update.selectionSet)notify();
      if (!switching && update.selectionSet) document.dispatchEvent(new CustomEvent('desktop:editor-selection',
        {detail:{documentId:selected,line:update.state.doc.lineAt(update.state.selection.main.head).number}}));
    }),
    EditorView.theme({
      '&':{height:'100%',fontFamily:'Consolas,"Microsoft YaHei",monospace',fontSize:'13px',color:'var(--shell-text)',backgroundColor:'var(--shell-surface)'},
      '.cm-scroller':{overflow:'auto',fontFamily:'inherit',lineHeight:'1.8'},
      '.cm-content':{padding:'16px 0',caretColor:'var(--shell-text)'},'.cm-line':{padding:'0 14px'},
      '.cm-gutters':{backgroundColor:'var(--shell-subtle)',color:'var(--shell-muted)',borderRight:'1px solid var(--shell-line)'},
      '.cm-activeLineGutter,.cm-activeLine':{backgroundColor:'var(--shell-selected)'},
      '&.cm-focused':{outline:'none'},'&.cm-focused .cm-cursor':{borderLeftColor:'var(--shell-text)'},
      '.cm-selectionBackground,&.cm-focused .cm-selectionBackground':{backgroundColor:'var(--shell-selected)'},
      '.cm-panels':{backgroundColor:'var(--shell-subtle)',color:'var(--shell-text)'},
      '.cm-search':{fontFamily:'var(--shell-ui-font)',fontSize:'12px',padding:'10px'},
      '.cm-search .cm-button':{background:'var(--shell-surface)',backgroundImage:'none',color:'var(--shell-text)',
        border:'1px solid var(--shell-line)',borderRadius:'4px',padding:'3px 7px',minHeight:'28px'},
      '.cm-search .cm-textfield':{background:'var(--shell-surface)',color:'var(--shell-text)',
        border:'1px solid var(--shell-line)',borderRadius:'4px',padding:'4px 6px'},
    }),
  ]});
}
const view = new EditorView({state:createState(''),parent:document.getElementById('editor-host')!});
view.contentDOM.id='markdown-editor';
view.scrollDOM.addEventListener('scroll',()=>document.dispatchEvent(new Event('desktop:editor-scroll')),{passive:true});
view.contentDOM.addEventListener('compositionstart',()=>{composing=true;document.dispatchEvent(new Event('desktop:editor-composition'));});
view.contentDOM.addEventListener('compositionend',()=>{composing=false;setTimeout(()=>document.dispatchEvent(new Event('desktop:editor-composition')),0);});
view.contentDOM.addEventListener('dblclick',event=>{
  const pos=view.posAtCoords({x:event.clientX,y:event.clientY});
  if(pos!==null)document.dispatchEvent(new CustomEvent('desktop:source-jump',{detail:{documentId:selected,line:view.state.doc.lineAt(pos).number}}));
});
const controller = {
  get revision(){return documentRevision;},
  get value(){return view.state.doc.toString();},
  get disabled(){return disabled;},
  set disabled(value:boolean){
    if(disabled===value)return;
    disabled=value;
    view.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});
  },
  get canUndo(){return !disabled&&undoDepth(view.state)>0;},
  get canRedo(){return !disabled&&redoDepth(view.state)>0;},
  getText:()=>view.state.doc.toString(),
  get composing(){return composing||view.composing||view.compositionStarted;},
  get selectionLine(){return view.state.doc.lineAt(view.state.selection.main.head).number;},
  viewportLine(){
    const height=Math.max(0,view.scrollDOM.getBoundingClientRect().top+12-view.documentTop);
    return view.state.doc.lineAt(view.lineBlockAtHeight(height).from).number;
  },
  revealLine(line:number,select=false){
    if(!selected||!Number.isFinite(line))return;
    const target=view.state.doc.line(Math.max(1,Math.min(view.state.doc.lines,Math.floor(line))));
    view.dispatch({...(select?{selection:{anchor:target.from}}:{}),effects:EditorView.scrollIntoView(target.from,{y:'start',yMargin:12})});
    if(select)view.focus();
  },
  focus:()=>view.focus(),
  renameDocument(from:string,to:string){
    if(selected===from)selected=to;
    const cached=states.get(from);if(cached){states.set(to,cached);states.delete(from);}
  },
  undo:()=>undo(view),redo:()=>redo(view),search:()=>openSearchPanel(view),
  showDocument(id:string,text:string,reset=false){
    const normalized=text.replace(/\r\n?/g,'\n');
    if(selected===id&&view.state.doc.toString()===normalized&&!reset)return;
    if(selected)states.set(selected,{state:view.state,scrollTop:view.scrollDOM.scrollTop});
    const previous=reset?undefined:states.get(id);
    switching=true;
    try {
      selected=id;
      documentRevision++;
      view.setState(previous?.state.doc.toString()===normalized?previous.state:createState(normalized));
      view.contentDOM.id='markdown-editor';
      // A stored state may have been captured while another operation was busy.
      view.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)])});
      const top=previous?.state.doc.toString()===normalized?previous.scrollTop:0;
      view.requestMeasure({read:()=>top,write:value=>{view.scrollDOM.scrollTop=value;}});
    } finally {switching=false;notify();}
  },
  clear(){switching=true;try{selected=null;documentRevision++;view.setState(createState(''));view.contentDOM.id='markdown-editor';}finally{switching=false;notify();}},
  retain(ids:string[]){for(const id of states.keys())if(!ids.includes(id))states.delete(id);},
};
declare global { interface Window { desktopCodeEditor:typeof controller; } }
window.desktopCodeEditor=controller;
document.querySelectorAll<HTMLButtonElement>('[data-editor-command]').forEach(button=>{
  button.addEventListener('click',()=>{
    const command=button.dataset.editorCommand;
    if(command==='undo')controller.undo(); else if(command==='redo')controller.redo(); else controller.search();
    if(command==='undo'||command==='redo')controller.focus();
    notify();
  });
});
function buttons(){
  document.querySelector<HTMLButtonElement>('[data-editor-command="undo"]')!.disabled=!controller.canUndo;
  document.querySelector<HTMLButtonElement>('[data-editor-command="redo"]')!.disabled=!controller.canRedo;
  document.querySelectorAll<HTMLButtonElement>('[data-editor-command="search"],[data-editor-command="replace"]').forEach(button=>{button.disabled=!selected;});
}
document.addEventListener('desktop:editor-history',buttons);
document.addEventListener('desktop:changed',buttons);
buttons();
window.addEventListener('unload',()=>view.destroy());
