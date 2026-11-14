import { documentAssets } from '../../src/exporters/document-assets';
import { getRenderDiagnostics } from '../../src/core/render-diagnostics';
import { ui } from './desktop-ui';

export type AssetFormat = 'original' | 'png' | 'svg' | 'drawio';
type Asset = ReturnType<typeof documentAssets>[number];
const supportedImage = /^image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i;
const maxBytes = 12 * 1024 * 1024;

export async function inspectDocumentAssets(content: HTMLElement) {
  const diagnostics = getRenderDiagnostics();
  const assets = documentAssets(content, diagnostics);
  for (const item of diagnostics) {
    if (item.kind !== 'block-missing' || assets.some(asset => asset.meta.blockId === item.blockId)) continue;
    assets.push({ meta: { index: 0, kind: 'diagram', type: item.type || 'diagram', line: item.line ?? null,
      blockId: item.blockId ?? null, alt: '', width: null, height: null, error: item.message }, image: null, vector: undefined });
  }
  assets.sort((a, b) => (a.meta.line ?? Infinity) - (b.meta.line ?? Infinity));
  return Promise.all(assets.map(async ({ meta, image, vector }, index) => {
    let error = meta.error;
    let formats: AssetFormat[] = [];
    let keySource = '';
    const src = image?.getAttribute('src') || '';
    if (meta.kind === 'image' && src.startsWith('documd:')) {
      const url = new URL(src);
      keySource = url.searchParams.get('relative') || url.searchParams.get('path') || '';
    } else if (meta.kind === 'image') keySource = src.slice(0, 200);
    if (!error) {
      try {
        await image?.decode();
        if (!image?.naturalWidth || !src) throw Error('Missing image');
        formats = meta.kind === 'image' ? ['original'] : ['png'];
        if (vector?.svg) formats.push('svg');
        if (vector?.drawioXml) formats.push('drawio');
      } catch { error = ui('图片无法加载：{0}', meta.alt || ui('未命名图片')); }
    }
    const key = JSON.stringify([meta.kind, meta.type, meta.line, meta.alt.slice(0, 240), keySource.slice(0, 512)]);
    return { entry: { ...meta, index: index + 1, alt: meta.alt.slice(0, 240), width: image?.naturalWidth || null,
      height: image?.naturalHeight || null, error: error?.slice(0, 500), key, formats }, image, vector };
  }));
}

export async function readAsset(asset: Pick<Asset, 'image' | 'vector'>, format: AssetFormat, resolve: (value: string) => string, encode: (bytes: Uint8Array) => string, source = asset.image?.getAttribute('src') || '') {
  if (format === 'svg' || format === 'drawio') {
    const data = format === 'svg' ? asset.vector?.svg : asset.vector?.drawioXml;
    if (!data) throw Error(ui('该资产不支持所选格式'));
    const bytes = new TextEncoder().encode(data);
    if (bytes.length > maxBytes) throw Error(ui('单个资产超过 12 MiB'));
    return { base64: encode(bytes), mime: format === 'svg' ? 'image/svg+xml' : 'application/x-drawio' };
  }
  if (!source) throw Error(ui('该资产无法读取'));
  const url = source.startsWith('data:image/') ? source : resolve(source);
  const response = await fetch(url);
  const mime = response.headers.get('Content-Type')?.split(';')[0].toLowerCase() || '';
  if (!response.ok || !supportedImage.test(mime) || (format === 'png' && mime !== 'image/png') || !response.body) throw Error(ui('该资产无法读取'));
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw Error(ui('单个资产超过 12 MiB'));
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  if (!size) throw Error(ui('该资产无法读取'));
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { base64: encode(bytes), mime };
}

export async function assetAsPng(data: { base64: string; mime: string }, encode: (bytes: Uint8Array) => string) {
  if (data.mime === 'image/png') return data;
  const source = URL.createObjectURL(new Blob([Uint8Array.from(atob(data.base64), character => character.charCodeAt(0))], { type: data.mime }));
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 16 * 1024 * 1024) {
      throw Error(ui('图片尺寸超出剪贴板限制'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw Error(ui('该资产无法读取'));
    if (png.size > maxBytes) throw Error(ui('单个资产超过 12 MiB'));
    return { base64: encode(new Uint8Array(await png.arrayBuffer())), mime: 'image/png' };
  } finally { URL.revokeObjectURL(source); }
}
