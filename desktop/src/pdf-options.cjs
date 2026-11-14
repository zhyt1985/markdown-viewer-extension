const sizes = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };

function pdfOptions(value = { paper: 'A4', orientation: 'portrait', margin: 12 }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3 || !Object.hasOwn(sizes, value.paper)
    || !['portrait', 'landscape'].includes(value.orientation)
    || !Number.isInteger(value.margin) || value.margin < 0 || value.margin > 35) {
    throw Error('Invalid PDF paper, orientation or margin');
  }
  const { paper, orientation, margin } = value;
  const [width, height] = orientation === 'portrait' ? sizes[paper] : [...sizes[paper]].reverse();
  const maxMediaHeight = Math.min(241.3, height - margin * 2 - 8);
  return {
    key: JSON.stringify([paper, orientation, margin]),
    css: `@page { size: ${width}mm ${height}mm; margin: ${margin}mm; }
      @media print {
        #markdown-content img, #markdown-content .diagram-block :is(img, svg) { max-height: ${maxMediaHeight}mm !important; }
        #markdown-content table { max-width: 100%; }
        #markdown-content :is(th, td) { overflow-wrap: anywhere; }
      }`,
  };
}
module.exports = { pdfOptions };
