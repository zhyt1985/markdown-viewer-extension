import { BaseI18nService, type LocaleMessages } from '../../src/services/base-i18n-service';
import { resolveDesktopLocale } from './desktop-locale';

export class DesktopI18n extends BaseI18nService {
  locales: Array<{ code: string; name: string }> = [];
  private effective = 'en';
  systemLocale = navigator.language;
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
    const resolved = resolveDesktopLocale(locale, this.systemLocale);
    if (this.ready && resolved === this.effective) { this.locale = locale; return; }
    await this.loadLocale(resolved);
    this.locale = locale; this.effective = resolved; this.ready = true;
  }
  getUILanguage() { return this.effective; }
}
