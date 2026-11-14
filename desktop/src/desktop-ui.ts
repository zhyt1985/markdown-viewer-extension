import { desktopText, type MessageValue } from './desktop-locale';

const shared: Record<string, string> = {
  '打开文件': 'open_file', '打开文件…': 'open_file', '取消': 'cancel', '关闭': 'close',
  '最近打开': 'recent_files', '语言': 'language', '跟随系统': 'settings_language_auto',
  '清理缓存': 'cache_clear', '自动刷新': 'settings_auto_refresh', '默认颜色': 'remark_cfg_default_color',
  '编辑备注': 'remark_add_note', '备注': 'remark_export_note', '删除': 'remark_delete',
  '撤销': 'remark_undo', '背景': 'remark_cfg_style_bg', '下划线': 'remark_cfg_style_underline',
  '波浪线': 'remark_cfg_style_wavy', '边框': 'remark_cfg_style_border', '普通布局': 'toolbar_layout_title_normal',
  '窄栏布局': 'toolbar_layout_title_narrow', '放大正文': 'toolbar_zoom_in_title', '缩小正文': 'toolbar_zoom_out_title',
  '文档主题': 'settings_theme_label', '表格对齐': 'settings_table_layout', '图片对齐': 'settings_image_layout',
  '图表对齐': 'settings_diagram_layout', '合并表格空单元格': 'settings_table_merge_empty',
  '分隔线显示': 'settings_docx_hr_display', 'Emoji 字体': 'settings_docx_emoji_style',
};

export function ui(source: string, ...values: MessageValue[]): string {
  const i18n = globalThis.platform?.i18n;
  const locale = i18n?.getUILanguage() ?? 'en';
  const key = shared[source];
  if (key && locale !== 'en' && locale !== 'zh_CN') {
    const translation = i18n?.translate(key, values.map(String));
    if (translation) return translation;
  }
  return desktopText(locale, source, ...values);
}

type Binding = { source: string; values: MessageValue[]; rendered: string };
const texts = new WeakMap<Element, Binding>();
const attributes = new WeakMap<Element, Record<string, Binding>>();
const attributeNames = ['aria-label', 'title', 'placeholder', 'alt'] as const;

export function bindUi(element: Element, source: string, ...values: MessageValue[]) {
  const rendered = ui(source, ...values);
  texts.set(element, { source, values, rendered });
  element.setAttribute('data-ui-text', '');
  if (element.textContent !== rendered) element.textContent = rendered;
}

export function uiSource(element: Element) {
  const binding = texts.get(element);
  return binding?.rendered === element.textContent ? binding.source : '';
}

export function bindUiAttribute(element: Element, name: typeof attributeNames[number], source: string, ...values: MessageValue[]) {
  const binding = attributes.get(element) || {};
  const rendered = ui(source, ...values);
  binding[name] = { source, values, rendered };
  attributes.set(element, binding);
  element.setAttribute(`data-ui-${name}`, '');
  element.setAttribute(name, rendered);
}

export function applyDesktopUi() {
  for (const element of document.querySelectorAll('[data-ui-text]')) {
    const binding = texts.get(element);
    if (!binding && element.closest('#markdown-content')) continue;
    if (binding && binding.rendered !== element.textContent) {
      texts.delete(element);
      element.removeAttribute('data-ui-text');
      continue;
    }
    bindUi(element, binding?.source ?? element.textContent?.trim() ?? '', ...(binding?.values || []));
  }
  for (const name of attributeNames) {
    for (const element of document.querySelectorAll(`[data-ui-${name}]`)) {
      const binding = attributes.get(element)?.[name];
      if (!binding && element.closest('#markdown-content')) continue;
      if (binding && binding.rendered !== element.getAttribute(name)) continue;
      bindUiAttribute(element, name, binding?.source ?? element.getAttribute(name) ?? '', ...(binding?.values || []));
    }
  }
}
