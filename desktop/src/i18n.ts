import { BaseI18nService, type LocaleMessages } from '../../src/services/base-i18n-service';

export class DesktopI18n extends BaseI18nService {
  locales: Array<{ code: string; name: string }> = [];
  private effective = 'en';
  async init() {
    const response = await fetch(new URL('_locales/registry.json', `${location.origin}/assets/`));
    if (!response.ok) throw Error('Locale registry unavailable');
    this.locales = (await response.json()).locales;
    await this.ensureFallbackMessages();
  }
  async fetchLocaleData(locale: string): Promise<LocaleMessages | null> {
    if (!this.locales.some(item => item.code === locale)) throw Error('Unsupported locale');
    const response = await fetch(new URL(`_locales/${locale}/messages.json`, `${location.origin}/assets/`));
    if (!response.ok) throw Error(`Locale unavailable: ${locale}`);
    return response.json();
  }
  async loadLocale(locale: string) { this.messages = await this.fetchLocaleData(locale); }
  async setLocale(locale: string) {
    if (!this.locales.length) await this.init();
    let resolved = locale;
    if (locale === 'auto') {
      const system = navigator.language.replace('-', '_');
      resolved = this.locales.find(item => item.code.toLowerCase() === system.toLowerCase())?.code
        || (system.startsWith('zh') ? (/(TW|HK|Hant)/i.test(system) ? 'zh_TW' : 'zh_CN') : this.locales.find(item => item.code === system.split('_')[0])?.code) || 'en';
    }
    await this.loadLocale(resolved);
    this.locale = locale; this.effective = resolved; this.ready = true;
  }
  getUILanguage() { return this.effective; }
}
