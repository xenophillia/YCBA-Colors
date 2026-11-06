import { extractPalette } from './palette.mjs';
import { galleryImages } from './gallery-images.mjs?v=2';
import { downloadGradientPng } from './gradient-export.mjs';

const input = document.querySelector('#painting-upload');
const painting = document.querySelector('#painting');
const workspace = document.querySelector('.workspace');
const markers = document.querySelector('#markers');
const palette = document.querySelector('#palette');
const status = document.querySelector('#status');
const mode = document.querySelector('#mode');
const restart = document.querySelector('#restart');
const moreColors = document.querySelector('#more-colors');
const fewerColors = document.querySelector('#fewer-colors');
const gallery = document.querySelector('#gallery');
const galleryToggle = document.querySelector('#gallery-toggle');
const main = document.querySelector('main');
const gradientToggle = document.querySelector('#gradient-toggle');
const gradientPreview = document.querySelector('#gradient-preview');
const markersToggle = document.querySelector('#markers-toggle');
const saveGradientButton = document.querySelector('#save-gradient');
let gradientStops = [];
let savingGradient = false;
let gradientActive = false;
let markersVisible = true;
let selectedGalleryUrl;
let colorCount;
let displayedCount = 0;
let currentUrl;
let uploadId = 0;
let imageData;
let pixelPicker;
let paletteColors = [];

const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

function updateMarkerVisibility(hasImage = Boolean(imageData)) {
  markers.hidden = gradientActive || !markersVisible;
  markersToggle.setAttribute('aria-pressed', String(markersVisible));
  markersToggle.title = markersVisible ? 'Hide color source dots' : 'Show color source dots';
  markersToggle.disabled = !hasImage || gradientActive;
}

markersToggle.addEventListener('click', () => {
  if (!imageData || gradientActive) return;
  markersVisible = !markersVisible;
  updateMarkerVisibility();
});

function setGradientActive(active) {
  gradientActive = active;
  gradientToggle.setAttribute('aria-pressed', String(active));
  gradientPreview.hidden = !active;
  // Keep the image's layout box so the gradient has exactly the same fitted size.
  painting.style.visibility = active ? 'hidden' : '';
  updateMarkerVisibility();
}

function renderGradient(colors) {
  // Sort a copy: the palette methods retain their own swatch and pair ordering.
  const ordered = [...colors].sort((a, b) => b.count - a.count);
  const hexes = ordered.map(color => toHex(color.rgb));
  let stops = hexes.length === 1
    ? [{ hex: hexes[0], offset: 0 }, { hex: hexes[0], offset: 1 }]
    : hexes.map((hex, index) => ({ hex, offset: index / (hexes.length - 1) }));
  let description = hexes;
  if (mode.value === 'prominent') {
    const total = ordered.reduce((sum, color) => sum + color.count, 0);
    const shares = ordered.map(color => color.count / total * 100);
    const percent = value => `${Number(value.toFixed(4))}%`;
    const positionedStop = (hex, position) => ({ hex, offset: Number(position.toFixed(4)) / 100 });
    let boundary = 0;
    stops = ordered.flatMap((color, index) => {
      const start = boundary;
      boundary += shares[index];
      // Blend symmetrically around each coverage boundary. This preserves each
      // color's proportional contribution while keeping the gradient smooth.
      const blendIn = index ? Math.min(shares[index - 1], shares[index]) / 2 : 0;
      const blendOut = index < ordered.length - 1 ? Math.min(shares[index], shares[index + 1]) / 2 : 0;
      return [
        positionedStop(hexes[index], start + blendIn),
        positionedStop(hexes[index], index === ordered.length - 1 ? 100 : boundary - blendOut),
      ];
    });
    description = hexes.map((hex, index) => `${hex} (${percent(shares[index])})`);
  }
  gradientStops = stops;
  const cssStops = stops.map(({ hex, offset }) => mode.value === 'prominent'
    ? `${hex} ${Number((offset * 100).toFixed(4))}%` : hex);
  gradientPreview.style.backgroundImage = `linear-gradient(to bottom, ${cssStops.join(', ')})`;
  gradientPreview.setAttribute('aria-label', `Palette gradient, most to least prominent from top to bottom: ${description.join(', ')}`);
  gradientToggle.disabled = false;
  saveGradientButton.disabled = savingGradient;
}

async function saveCurrentGradient() {
  if (!imageData || !pixelPicker || !gradientStops.length || savingGradient) return;
  savingGradient = true;
  saveGradientButton.disabled = true;
  const { source } = pixelPicker;
  try {
    await downloadGradientPng(gradientStops, source.naturalWidth, source.naturalHeight);
  } catch {
    status.textContent = 'Could not save the gradient. Please try again.';
  } finally {
    savingGradient = false;
    saveGradientButton.disabled = !imageData || !gradientStops.length;
  }
}

saveGradientButton.addEventListener('click', saveCurrentGradient);
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 's' || event.ctrlKey || event.metaKey || event.altKey
    || event.repeat || event.isComposing || event.defaultPrevented) return;
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"]')) return;
  if (!imageData || !pixelPicker) return;
  event.preventDefault();
  return saveCurrentGradient();
});

gradientToggle.addEventListener('click', () => {
  if (imageData) setGradientActive(!gradientActive);
});

async function copyHex(hex) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(hex);
    return;
  }
  // Support local previews where the Clipboard API is unavailable.
  const field = document.createElement('textarea');
  field.value = hex;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  const focused = document.activeElement;
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    field.remove();
    focused?.focus();
  }
}

function renderPalette(sample) {
  const colors = extractPalette(sample.data, sample.width, sample.height, mode.value, colorCount);
  paletteColors = colors;
  renderGradient(colors);
  updateMarkerVisibility(true);
  displayedCount = colors.length;
  moreColors.disabled = (colorCount ?? displayedCount) >= 10;
  fewerColors.disabled = (colorCount ?? displayedCount) <= 2;
  const colorLabel = { prominent: 'Prominent', saturated: 'Saturated', complimentary: 'Complimentary' }[mode.value];
  palette.setAttribute('aria-label', `${colors.length} ${colorLabel.toLowerCase()} ${colors.length === 1 ? 'color' : 'colors'}`);
  palette.replaceChildren();
  markers.replaceChildren();
  colors.forEach((color, index) => {
    let hex = toHex(color.rgb);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.style.backgroundColor = hex;
    const description = mode.value === 'complimentary' && colors.length > 1
      ? `Pair ${Math.floor(index / 2) + 1}, ${index % 2 ? 'complement' : 'saturated anchor'}`
      : `${colorLabel} color ${index + 1}`;
    swatch.title = `${description}: ${hex}`;
    swatch.setAttribute('aria-label', `${description}, ${hex}. Copy hex code`);
    const label = document.createElement('span');
    label.className = 'swatch-label';
    label.textContent = hex;
    label.setAttribute('aria-hidden', 'true');
    swatch.append(label);
    let feedbackTimer;
    swatch.addEventListener('click', async () => {
      const copiedHex = hex;
      try {
        await copyHex(copiedHex);
        if (hex !== copiedHex) return;
        label.textContent = 'Copied!';
      } catch {
        if (hex !== copiedHex) return;
        label.textContent = 'Copy failed';
        status.textContent = `Could not copy. Hex code: ${hex}`;
      }
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { label.textContent = hex; }, 1500);
    });
    palette.append(swatch);
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'marker';
    marker.title = 'Drag to pick a color. Arrow keys move one pixel; Shift moves ten.';

    function updateColorViews() {
      clearTimeout(feedbackTimer);
      hex = toHex(color.rgb);
      swatch.style.backgroundColor = hex;
      swatch.title = `${description}: ${hex}`;
      swatch.setAttribute('aria-label', `${description}, ${hex}. Copy hex code`);
      label.textContent = hex;
      marker.style.left = `${color.x * 100}%`;
      marker.style.top = `${color.y * 100}%`;
      marker.setAttribute('aria-label', `Color ${index + 1}, ${hex}. Drag or use arrow keys to pick a color`);
    }

    const canPick = () => pixelPicker && imageData && paletteColors === colors && !markers.hidden;
    function pickAt(x, y) {
      if (!canPick()) return;
      const { source, context } = pixelPicker;
      const px = Math.max(0, Math.min(source.naturalWidth - 1, Math.floor(x * source.naturalWidth)));
      const py = Math.max(0, Math.min(source.naturalHeight - 1, Math.floor(y * source.naturalHeight)));
      // Sample one original pixel, composited over the same white as the page.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 1, 1);
      context.drawImage(source, px, py, 1, 1, 0, 0, 1, 1);
      color.rgb = [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      color.x = (px + .5) / source.naturalWidth;
      color.y = (py + .5) / source.naturalHeight;
      updateColorViews();
      renderGradient(colors);
    }

    let pointerId, grabX, grabY;
    marker.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pointerId !== undefined || !canPick()) return;
      const rect = painting.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      event.preventDefault();
      pointerId = event.pointerId;
      // Keep the grab point stable when the edge of a dot is picked up.
      grabX = event.clientX - (rect.left + color.x * rect.width);
      grabY = event.clientY - (rect.top + color.y * rect.height);
      marker.setPointerCapture(pointerId);
      marker.setAttribute('data-dragging', 'true');
      marker.focus({ preventScroll: true });
    });
    function movePointer(event) {
      if (event.pointerId !== pointerId || pointerId === undefined) return;
      const rect = painting.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pickAt((event.clientX - grabX - rect.left) / rect.width, (event.clientY - grabY - rect.top) / rect.height);
    }
    function finishPointer(event) {
      if (event.pointerId !== pointerId || pointerId === undefined) return;
      pointerId = undefined;
      marker.removeAttribute('data-dragging');
      if (marker.hasPointerCapture(event.pointerId)) marker.releasePointerCapture(event.pointerId);
    }
    marker.addEventListener('pointermove', movePointer);
    marker.addEventListener('pointerup', event => { movePointer(event); finishPointer(event); });
    marker.addEventListener('pointercancel', finishPointer);
    marker.addEventListener('lostpointercapture', finishPointer);
    marker.addEventListener('keydown', event => {
      if (!canPick()) return;
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      pickAt(color.x + direction[0] * step / pixelPicker.source.naturalWidth,
        color.y + direction[1] * step / pixelPicker.source.naturalHeight);
    });
    updateColorViews();
    markers.append(marker);
  });
}

function changeColorCount(delta) {
  if (!imageData) return;
  colorCount = Math.max(2, Math.min(10, (colorCount ?? displayedCount) + delta));
  renderPalette(imageData);
}
moreColors.addEventListener('click', () => changeColorCount(1));
fewerColors.addEventListener('click', () => changeColorCount(-1));

mode.addEventListener('change', () => {
  if (imageData) renderPalette(imageData);
});

restart.addEventListener('click', () => {
  ++uploadId; // Invalidate an upload that is still decoding.
  painting.removeAttribute('src');
  painting.alt = 'Uploaded painting';
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = undefined;
  imageData = undefined;
  pixelPicker = undefined;
  paletteColors = [];
  gradientStops = [];
  saveGradientButton.disabled = true;
  markersVisible = true;
  setGradientActive(false);
  gradientToggle.disabled = true;
  gradientPreview.style.backgroundImage = '';
  gradientPreview.setAttribute('aria-label', 'Palette gradient');
  colorCount = undefined;
  input.value = '';
  mode.value = 'prominent';
  markers.replaceChildren();
  palette.replaceChildren();
  workspace.hidden = true;
  restart.hidden = true;
  status.textContent = '';
  selectedGalleryUrl = undefined;
  updateGallerySelection();
  input.focus();
});

function updateGallerySelection() {
  gallery.children && Array.from(gallery.children).forEach((button, index) => {
    if (galleryImages[index]) button.setAttribute('aria-pressed', String(galleryImages[index] === selectedGalleryUrl));
  });
}

function renderGallery() {
  gallery.replaceChildren();
  if (!galleryImages.length) {
    for (let i = 0; i < 9; i++) {
      const placeholder = document.createElement('div');
      placeholder.className = 'gallery-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      gallery.append(placeholder);
    }
    return;
  }
  galleryImages.forEach((url, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-item';
    const name = decodeURIComponent(url.split('/').pop());
    button.setAttribute('aria-label', `Select ${name}`);
    button.setAttribute('aria-pressed', 'false');
    const thumbnail = document.createElement('img');
    thumbnail.src = url;
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    button.append(thumbnail);
    button.addEventListener('click', () => loadPainting(url, name, false));
    gallery.append(button);
  });
}

galleryToggle.addEventListener('click', () => {
  const enabled = main.classList.toggle('gallery-view');
  galleryToggle.setAttribute('aria-pressed', String(enabled));
});

async function loadPainting(url, name, uploaded = false) {
  const id = ++uploadId;
  status.textContent = 'Picking colors…';
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    if (id !== uploadId) { if (uploaded) URL.revokeObjectURL(url); return; }
    const scale = Math.min(1, 240 / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const sample = context.getImageData(0, 0, canvas.width, canvas.height);
    colorCount = undefined;
    renderPalette(sample);
    imageData = sample;
    // Reuse the analysis canvas as a tiny original-resolution pixel sampler.
    canvas.width = 1;
    canvas.height = 1;
    pixelPicker = { source, context };
    painting.parentElement?.style.setProperty('--painting-ratio', source.naturalWidth / source.naturalHeight);
    painting.src = url;
    painting.alt = `${uploaded ? 'Uploaded painting' : 'Painting'}: ${name}`;
    workspace.hidden = false;
    restart.hidden = false;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = uploaded ? url : undefined;
    selectedGalleryUrl = uploaded ? undefined : url;
    updateGallerySelection();
    status.textContent = '';
  } catch (error) {
    if (uploaded) URL.revokeObjectURL(url);
    if (id === uploadId) status.textContent = error.message === 'This image has no visible pixels.' ? error.message : 'Could not read this image. Try a JPG, PNG, or WebP file.';
  } finally {
    if (id === uploadId) input.value = '';
  }
}

input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  await loadPainting(URL.createObjectURL(file), file.name, true);
});

renderGallery();
if (galleryImages.length) loadPainting(galleryImages[0], decodeURIComponent(galleryImages[0].split('/').pop()));
