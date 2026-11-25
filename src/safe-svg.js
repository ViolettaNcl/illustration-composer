// Deliberately limited to static, editable SVG geometry. No active or remote content.
const NS = 'http://www.w3.org/2000/svg';
const tags = new Set('svg g path rect circle ellipse line polyline polygon title desc defs linearGradient radialGradient stop clipPath mask'.split(' '));
const attrs = new Set('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry fx fy fr d points transform fill stroke fill-rule clip-rule fill-opacity stroke-opacity opacity stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset vector-effect gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity clip-path clipPathUnits mask maskUnits maskContentUnits preserveAspectRatio'.split(' '));
export function sanitizeSVG(text) {
  if (typeof text !== 'string' || text.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Недопустимый SVG');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== NS || doc.querySelector('parsererror')) throw new Error('Некорректный SVG');
  function clean(node) {
    if (node.namespaceURI !== NS || !tags.has(node.localName)) throw new Error('Неподдерживаемый элемент SVG: ' + node.localName);
    for (const attr of [...node.attributes]) {
      const name = attr.name, value = attr.value.trim();
      if (name === 'xmlns' && value === NS) continue;
      if (attr.namespaceURI || !attrs.has(name)) { node.removeAttributeNode(attr); continue; }
      if (/url\s*\(/i.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/.test(value)) throw new Error('Внешние ссылки в SVG запрещены');
      if (/[<>\\]/.test(value) || /(?:javascript|data|https?|file):/i.test(value)) throw new Error('Недопустимое значение SVG');
    }
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) clean(child);
      else if (child.nodeType !== 3 || !['title','desc'].includes(node.localName)) child.remove();
    }
  }
  clean(root);
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4) vb = [0, 0, parseFloat(root.getAttribute('width')) || 100, parseFloat(root.getAttribute('height')) || 100];
  if (!vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0) throw new Error('Некорректные размеры SVG');
  root.setAttribute('viewBox', vb.join(' '));
  return new XMLSerializer().serializeToString(root);
}
