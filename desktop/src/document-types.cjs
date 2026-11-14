const { EXT_LANG_MAP } = require('../../src/utils/extension-categories.ts');
const { DIAGRAM_FORMATS, SUPPORTED_FORMATS } = require('../../src/types/formats.ts');

const htmlExtensions = ['html', 'htm'];
const sourceLanguages = Object.fromEntries(Object.entries(EXT_LANG_MAP)
  .filter(([extension]) => !htmlExtensions.includes(extension)));
const markdownExtensions = ['md', 'markdown'];
const imageTypes = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
};
const diagrams = new Map(DIAGRAM_FORMATS.flatMap(format => format.extensions.map(extension => [extension, {
  diagramType: format.fileType, diagramLanguage: format.languageId,
}])));
const textDocumentExtensions = [...markdownExtensions, ...htmlExtensions, ...diagrams.keys(), ...Object.keys(sourceLanguages).filter(extension => !extension.includes('.'))];
const documentExtensions = [...textDocumentExtensions, ...Object.keys(imageTypes)];

function documentType(filename) {
  // Local names can contain a literal # or %, so do not parse them as URLs.
  if (SUPPORTED_FORMATS.find(format => format.fileType === 'slidev')?.extensions.some(extension => filename.toLowerCase().endsWith(`.${extension}`))) return { slidev: true };
  const extension = /\.([^./\\]+)$/.exec(filename)?.[1].toLowerCase();
  if (markdownExtensions.includes(extension)) return { sourceLanguage: null };
  if (htmlExtensions.includes(extension)) return { html: true };
  if (diagrams.has(extension)) return diagrams.get(extension);
  if (Object.hasOwn(sourceLanguages, extension)) return { sourceLanguage: sourceLanguages[extension] };
  if (Object.hasOwn(imageTypes, extension)) return { imageMimeType: imageTypes[extension] };
  return null;
}

const isReadOnly = document => Boolean(document?.sourceLanguage || document?.imageMimeType || document?.html || document?.diagramType || document?.slidev);
const canRenderDocument = document => Boolean(document && (document.diagramType || document.slidev || !isReadOnly(document)));

module.exports = { documentExtensions, textDocumentExtensions, documentType, isReadOnly, canRenderDocument };
