const counters = new Map();

function nextFilename(date) {
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
  return `Colortest_${day}-${month}_${next}.png`;
}

export async function downloadGradientPng(stops, width, height, date = new Date()) {
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

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = nextFilename(date);
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    return link.download;
  } finally {
    // Give the browser time to begin the download before releasing the PNG URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
