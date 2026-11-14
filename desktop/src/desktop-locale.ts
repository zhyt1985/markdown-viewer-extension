import registry from '../../src/_locales/registry.json';
import english from './desktop-messages.en.json';

export type MessageValue = string | number;

export function resolveDesktopLocale(preferred: string | undefined, system: string): string {
  const locales = registry.locales.map(item => item.code);
  if (preferred && preferred !== 'auto' && locales.includes(preferred)) return preferred;
  const normalized = system.replaceAll('-', '_').toLowerCase();
  const exact = locales.find(code => code.toLowerCase() === normalized);
  if (exact) return exact;
  const language = normalized.split('_')[0];
  if (language === 'zh') return /(?:^|_)(?:tw|hk|mo|hant)(?:_|$)/.test(normalized) ? 'zh_TW' : 'zh_CN';
  return locales.find(code => code === language || code.startsWith(`${language}_`)) || 'en';
}

// The original Simplified Chinese strings are the message keys.
export function desktopText(locale: string, source: string, ...values: MessageValue[]): string {
  const template = locale === 'zh_CN' ? source : (english as Record<string, string>)[source] ?? source;
  return template.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)]?.toString() ?? token);
}

export function desktopFilename(locale: string, name: string, untitled?: boolean): string {
  const number = untitled && /^未命名 ([1-9]\d*)\.md$/.exec(name)?.[1];
  return number ? desktopText(locale, '未命名 {0}.md', number) : name;
}
