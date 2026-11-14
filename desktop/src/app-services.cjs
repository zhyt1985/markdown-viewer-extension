function createAppServices(stateStore, cache, isDocumentAllowed, onChange = () => {}, { schema = [], locales = [] } = {}) {
  function validateSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Invalid settings');
    for (const [key, value] of Object.entries(settings)) {
      const rule = schema.find(item => item.key === key);
      if (!rule) throw Error(`Unsupported setting: ${key}`);
      if (rule.type === 'enum' ? !rule.values.includes(value) : typeof value !== rule.type) throw Error(`Invalid setting: ${key}`);
      if (rule.type === 'number' && (!Number.isFinite(value) || value < rule.min || value > rule.max)) throw Error(`Invalid setting: ${key}`);
      if (rule.type === 'string' && (value.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(value))) throw Error(`Invalid setting: ${key}`);
      if (key === 'preferredLocale' && value !== 'auto' && !locales.includes(value)) throw Error('Unsupported locale');
    }
  }
  const validateKeys = keys => {
    const list = typeof keys === 'string' ? [keys] : keys;
    if (!Array.isArray(list) || list.some(key => key !== 'markdownViewerSettings')) throw Error('Invalid storage key');
    return list;
  };
  async function dispatch(type, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid service payload');
    if (type === 'STORAGE_GET') return stateStore.get(validateKeys(payload.keys));
    if (type === 'STORAGE_SET') {
      if (!payload.items || typeof payload.items !== 'object' || Array.isArray(payload.items)) throw Error('Invalid storage items');
      validateKeys(Object.keys(payload.items));
      if (Object.hasOwn(payload.items, 'markdownViewerSettings')) validateSettings(payload.items.markdownViewerSettings);
      await stateStore.update('set', payload.items);
      if (Object.hasOwn(payload.items, 'markdownViewerSettings')) onChange({ type: 'SETTINGS_CHANGED' }, payload.items.markdownViewerSettings);
      return {};
    }
    if (type === 'STORAGE_REMOVE') { await stateStore.update('remove', validateKeys(payload.keys)); onChange({ type: 'SETTINGS_CHANGED' }); return {}; }
    if (type === 'FILE_STATE_OPERATION') {
      const { url, operation, state } = payload;
      if (typeof url !== 'string' || !/^[a-f0-9]{64}$/.test(url) || !isDocumentAllowed(url)) throw Error('Invalid reading document');
      const key = `reading:${url}`;
      if (operation === 'get') return (await stateStore.get([key]))[key] || {};
      if (operation === 'clear') { await stateStore.update('remove', [key]); return {}; }
      if (operation !== 'set' || !state || typeof state !== 'object' || Array.isArray(state)) throw Error('Invalid reading operation');
      const numeric = { scrollTop: [0, 1e9], scrollLine: [0, 1e9], zoom: [0.25, 4] };
      for (const [name, value] of Object.entries(state)) {
        if (numeric[name]) {
          if (!Number.isFinite(value) || value < numeric[name][0] || value > numeric[name][1]) throw Error('Invalid reading value');
        } else if (name === 'tocVisible') { if (typeof value !== 'boolean') throw Error('Invalid reading value'); }
        else if (name === 'layoutMode') { if (!['normal', 'fullscreen', 'narrow'].includes(value)) throw Error('Invalid reading value'); }
        else if (name === 'documentMode') { if (!['reading', 'split', 'source'].includes(value)) throw Error('Invalid reading value'); }
        else throw Error('Unsupported reading field');
      }
      await stateStore.mutate(values => { values[key] = { ...(values[key] || {}), ...state }; });
      return {};
    }
    if (type === 'CACHE_OPERATION') {
      const { operation, key, value, dataType } = payload;
      if (['get', 'set', 'delete'].includes(operation) && (typeof key !== 'string' || key.length > 512)) throw Error('Invalid cache key');
      if (operation === 'get') return cache.get(key);
      if (operation === 'set') return { success: await cache.set(key, value, dataType) };
      if (operation === 'delete') return { success: await cache.delete(key) };
      if (operation === 'clear') return { success: await cache.clear() };
      if (operation === 'getStats') return cache.stats();
      throw Error('Unsupported cache operation');
    }
    if (type === 'PING') return { ready: true };
    throw Error(`Unsupported desktop service: ${type}`);
  }
  return async envelope => {
    if (!envelope || typeof envelope.id !== 'string' || envelope.id.length > 128 || typeof envelope.type !== 'string'
        || JSON.stringify(envelope).length > 12 * 1024 * 1024) throw Error('Invalid service envelope');
    try { return { type: 'RESPONSE', requestId: envelope.id, ok: true, data: await dispatch(envelope.type, envelope.payload) }; }
    catch (error) { return { type: 'RESPONSE', requestId: envelope.id, ok: false, error: { message: error.message } }; }
  };
}
module.exports = { createAppServices };
