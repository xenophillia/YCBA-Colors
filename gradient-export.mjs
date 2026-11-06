const counters = new Map();

function nextFilename(date, extension) {
  const day = date.getDate(), month = date.getMonth() + 1;
  const key = `colorpicker-exports-${date.getFullYear()}-${month}-${day}`;
  let previous = counters.get(key) || 0;
  try {
    const stored = Number(globalThis.localStorage?.getItem(key));
    if (Number.isSafeInteger(stored) && stored > previous) previous = stored;
  } catch { /* Keep numbering within the session when storage is unavailable. */ }
  const next = previous + 1;
  counters.set(key, next);
  try { globalThis.localStorage?.setItem(key, String(next)); } catch { /* Session fallback. */ }
  return `Colortest_${day}-${month}_${next}.${extension}`;
}

function downloadBlob(blob, extension, date) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = nextFilename(date, extension);
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    return link.download;
  } finally {
    // Give the browser time to begin the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function validateStops(stops) {
  if (!Array.isArray(stops) || !stops.length) throw new Error('The gradient has no color stops.');
  for (let i = 0; i < stops.length; i++) {
    const { hex, offset } = stops[i];
    if (!/^#[\da-f]{6}$/i.test(hex) || !Number.isFinite(offset) || offset < 0 || offset > 1
      || (i > 0 && offset < stops[i - 1].offset)) throw new Error('Invalid gradient color stop.');
  }
}

function validateDimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Invalid gradient dimensions.');
  }
}

export async function downloadGradientPng(stops, width, height, date = new Date()) {
  validateStops(stops);
  validateDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the PNG canvas.');
  const gradient = context.createLinearGradient(0, 0, 0, height);
  for (const { hex, offset } of stops) gradient.addColorStop(offset, hex);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the gradient as PNG.');
  return downloadBlob(blob, 'png', date);
}

export function createGradientSvg(stops, width, height) {
  validateStops(stops);
  validateDimensions(width, height);
  // Native SVG stops retain the precise offsets, including repeated colors and
  // coincident stops: https://www.w3.org/TR/SVG11/pservers.html
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>YCBA Colors gradient</title>
  <defs>
    <linearGradient id="palette-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}" color-interpolation="sRGB" spreadMethod="pad">
${stops.map(({ hex, offset }) => `      <stop offset="${offset}" stop-color="${hex}"/>`).join('\n')}
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#palette-gradient)"/>
</svg>
`;
}

function aseString(text) {
  const bytes = new Uint8Array(2 + (text.length + 1) * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, text.length + 1);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i));
  return bytes; // The zero-initialized last UTF-16BE code unit terminates the name.
}

function aseBlock(type, payload) {
  const bytes = new Uint8Array(6 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, type);
  view.setUint32(2, payload.length);
  bytes.set(payload, 6);
  return bytes;
}

export function createGradientAse(stops) {
  validateStops(stops);
  // ASE 1.0: big-endian blocks, UTF-16BE names, RGB float32 channels, process
  // swatches. Reference implementation: https://gist.github.com/facelessuser/8063529649d206c05cf9
  const blocks = [aseBlock(0xc001, aseString('YCBA Colors'))];
  stops.forEach(({ hex, offset }, index) => {
    const position = Number((offset * 100).toFixed(4));
    const name = aseString(`Stop ${String(index + 1).padStart(2, '0')} ${hex} @ ${position}%`);
    const payload = new Uint8Array(name.length + 18);
    const view = new DataView(payload.buffer);
    payload.set(name);
    payload.set([82, 71, 66, 32], name.length); // "RGB "
    for (let channel = 0; channel < 3; channel++) {
      view.setFloat32(name.length + 4 + channel * 4, parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255);
    }
    view.setUint16(name.length + 16, 2); // Normal/process color, not a spot color.
    blocks.push(aseBlock(0x0001, payload));
  });
  blocks.push(aseBlock(0xc002, new Uint8Array()));
  const output = new Uint8Array(12 + blocks.reduce((sum, block) => sum + block.length, 0));
  output.set([65, 83, 69, 70]); // "ASEF"
  const header = new DataView(output.buffer);
  header.setUint16(4, 1);
  header.setUint16(6, 0);
  header.setUint32(8, blocks.length);
  let cursor = 12;
  for (const block of blocks) { output.set(block, cursor); cursor += block.length; }
  return output;
}

export function downloadGradientSvg(stops, width, height, date = new Date()) {
  return downloadBlob(new Blob([createGradientSvg(stops, width, height)], { type: 'image/svg+xml;charset=utf-8' }), 'svg', date);
}

export function downloadGradientAse(stops, _width, _height, date = new Date()) {
  return downloadBlob(new Blob([createGradientAse(stops)], { type: 'application/octet-stream' }), 'ase', date);
}
