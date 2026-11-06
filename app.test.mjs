import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise browser event/state behavior without adding a browser dependency.
class Element {
  value = '';
  hidden = false;
  children = [];
  style = {};
  events = {};
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
  focus() { this.focused = true; }
}

function sample(colors) {
  return { width: colors.length, height: 1, data: new Uint8ClampedArray(colors.flatMap(rgb => [...rgb, 255])) };
}

test('uploads, palette controls, gradient view, and restart keep the preview in sync', async () => {
  const oldDocument = globalThis.document, oldImage = globalThis.Image;
  const nodes = Object.fromEntries(['#painting-upload', '#painting', '.workspace', '#markers', '#palette', '#status', '#mode', '#restart', '#more-colors', '#fewer-colors', '#gallery', '#gallery-toggle', '#gradient-toggle', '#gradient-preview', '#markers-toggle', '#save-gradient', 'main'].map(id => [id, new Element()]));
  const documentEvents = {}, savedGradients = [];
  let saveGate;
  globalThis.__testGradientDownload = async (stops, width, height) => {
    savedGradients.push({ stops: structuredClone(stops), width, height });
    await saveGate;
  };
  nodes['.workspace'].hidden = true;
  nodes['#restart'].hidden = true;
  nodes['#mode'].value = 'prominent';
  nodes['#gradient-toggle'].disabled = true;
  nodes['#gradient-toggle'].setAttribute('aria-pressed', 'false');
  nodes['#gradient-preview'].hidden = true;
  nodes['#markers-toggle'].disabled = true;
  nodes['#markers-toggle'].setAttribute('aria-pressed', 'true');
  let currentSample = sample([[40, 60, 120]]), decodeGate;
  globalThis.document = {
    addEventListener: (name, handler) => { documentEvents[name] = handler; },
    querySelector: id => nodes[id],
    createElement: tag => tag === 'canvas'
      ? { getContext: () => ({ drawImage() {}, getImageData: () => currentSample }) }
      : new Element(),
  };
  globalThis.Image = class {
    naturalWidth = 10;
    naturalHeight = 1;
    decode() { return decodeGate || Promise.resolve(); }
  };
  const file = new Blob(['test image']);
  file.name = 'painting.png';
  const upload = () => {
    nodes['#painting-upload'].files = [file];
    return nodes['#painting-upload'].events.change();
  };
  const changeMode = mode => {
    nodes['#mode'].value = mode;
    nodes['#mode'].events.change();
  };
  const expectColors = (count, label) => {
    assert.equal(nodes['#palette'].children.length, count);
    assert.equal(nodes['#markers'].children.length, count);
    assert.equal(nodes['#palette']['aria-label'], `${count} ${label} ${count === 1 ? 'color' : 'colors'}`);
    assert.equal(nodes['.workspace'].hidden, false);
    assert.equal(nodes['#restart'].hidden, false);
    assert.equal(nodes['#gradient-toggle'].disabled, false);
    const stops = nodes['#gradient-preview'].style.backgroundImage.match(/#[a-f0-9]{6}/g);
    assert.equal(stops.length, label === 'prominent' ? count * 2 : Math.max(2, count));
    if (label === 'prominent') {
      const positions = [...nodes['#gradient-preview'].style.backgroundImage.matchAll(/([\d.]+)%/g)].map(match => Number(match[1]));
      assert.equal(positions[0], 0);
      assert.equal(positions.at(-1), 100);
      assert(positions.every((position, index) => index === 0 || position >= positions[index - 1]));
    }
  };
  const expectGradient = hexes => {
    const stops = hexes.length === 1 ? [...hexes, ...hexes] : hexes;
    assert.equal(nodes['#gradient-preview'].style.backgroundImage, `linear-gradient(to bottom, ${stops.join(', ')})`);
    assert.equal(nodes['#gradient-preview'].hidden, false);
    assert.equal(nodes['#painting'].style.visibility, 'hidden');
    assert.equal(nodes['#markers'].hidden, true);
    assert.equal(nodes['#markers-toggle'].disabled, true);
    assert.equal(nodes['#gradient-toggle']['aria-pressed'], 'true');
  };
  const shortcut = (extra = {}) => {
    const event = { key: 's', target: nodes.main, preventDefault() { this.prevented = true; }, ...extra };
    return { event, result: documentEvents.keydown(event) };
  };
  try {
    const source = (await readFile(new URL('./app.js', import.meta.url), 'utf8'))
      .replace("'./palette.mjs'", JSON.stringify(new URL('./palette.mjs', import.meta.url).href))
      .replace("import { downloadGradientPng } from './gradient-export.mjs';", 'const downloadGradientPng = globalThis.__testGradientDownload;')
      .replace(/import \{ galleryImages \} from '\.\/gallery-images\.mjs(?:\?[^']*)?';/, "const galleryImages = ['./images/first.png', './images/second.png'];");
    await import('data:text/javascript,' + encodeURIComponent(source));
    await Promise.resolve();
    assert.equal(nodes['#gallery'].children.length, 2);
    assert.equal(nodes['#painting'].src, './images/first.png');
    assert.equal(nodes['#gallery'].children[0]['aria-pressed'], 'true');
    await nodes['#gallery'].children[1].events.click();
    assert.equal(nodes['#painting'].src, './images/second.png');
    assert.equal(nodes['#gallery'].children[1]['aria-pressed'], 'true');
    assert.equal(nodes['#gallery'].children[0]['aria-pressed'], 'false');
    await upload();
    assert.equal(nodes['#gallery'].children[1]['aria-pressed'], 'false');
    expectColors(1, 'prominent');
    assert.equal(nodes['#gradient-preview'].hidden, true);
    assert.equal(nodes['#save-gradient'].disabled, false);
    await nodes['#save-gradient'].events.click(); // Save also works in painting view.
    assert.deepEqual(savedGradients[0], { stops: [{ hex: '#283c78', offset: 0 }, { hex: '#283c78', offset: 1 }], width: 10, height: 1 });
    for (const extra of [
      { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true },
      { isComposing: true }, { defaultPrevented: true },
      { target: { isContentEditable: true } },
      { target: { closest: () => ({ tagName: 'SELECT' }) } },
      { key: 'a' },
    ]) assert.equal(shortcut(extra).event.prevented, undefined);
    assert.equal(savedGradients.length, 1);
    const lower = shortcut();
    await lower.result;
    assert.equal(lower.event.prevented, true);
    await shortcut({ key: 'S' }).result;
    assert.equal(savedGradients.length, 3);
    assert.equal(nodes['#markers-toggle'].disabled, false);
    assert.equal(nodes['#markers'].hidden, false);
    const originalMarkers = nodes['#markers'].children;
    const originalSwatches = nodes['#palette'].children;
    nodes['#markers-toggle'].events.click();
    assert.equal(nodes['#markers'].hidden, true);
    assert.equal(nodes['#markers-toggle']['aria-pressed'], 'false');
    assert.equal(nodes['#markers-toggle'].title, 'Show color source dots');
    assert.equal(nodes['#markers'].children, originalMarkers);
    assert.equal(nodes['#palette'].children, originalSwatches);
    changeMode('saturated');
    assert.equal(nodes['#markers'].hidden, true);
    await upload();
    assert.equal(nodes['#markers'].hidden, true);
    changeMode('prominent');
    nodes['#gradient-toggle'].events.click();
    assert.equal(nodes['#markers-toggle'].disabled, true);
    nodes['#gradient-toggle'].events.click();
    assert.equal(nodes['#markers'].hidden, true);
    assert.equal(nodes['#markers-toggle'].disabled, false);
    nodes['#markers-toggle'].events.click();
    assert.equal(nodes['#markers'].hidden, false);
    assert.equal(nodes['#markers-toggle']['aria-pressed'], 'true');
    assert.equal(nodes['#markers-toggle'].title, 'Hide color source dots');
    nodes['#gradient-toggle'].events.click();
    expectGradient(['#283c78 0%', '#283c78 100%']);
    changeMode('complimentary');
    expectColors(1, 'complimentary');
    expectGradient(['#283c78']);
    assert(!nodes['#palette'].children[0].title.includes('Pair'));

    currentSample = sample([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    await upload();
    expectColors(2, 'complimentary');
    changeMode('prominent');
    expectColors(3, 'prominent');
    changeMode('saturated');
    expectColors(3, 'saturated');

    // Saturation and complement ordering differ from image coverage. The gradient
    // must use coverage while preserving the method's original swatch order.
    currentSample = sample([
      ...Array.from({ length: 50 }, () => [120, 120, 120]),
      ...Array.from({ length: 30 }, () => [0, 0, 255]),
      ...Array.from({ length: 20 }, () => [255, 0, 0]),
    ]);
    await upload();
    expectColors(3, 'saturated');
    expectGradient(['#787878', '#0000ff', '#ff0000']);
    assert.equal(nodes['#palette'].children[0].style.backgroundColor, '#ff0000');
    changeMode('complimentary');
    expectColors(2, 'complimentary');
    expectGradient(['#0000ff', '#ff0000']);
    assert.equal(nodes['#palette'].children[0].style.backgroundColor, '#0000ff');
    changeMode('prominent');
    expectColors(3, 'prominent');
    // Coverage is 50/30/20. Transitions straddle the 50% and 80% boundaries
    // symmetrically, so each color retains its measured share of the gradient.
    const weightedStops = ['#787878 0%', '#787878 35%', '#0000ff 65%', '#0000ff 70%', '#ff0000 90%', '#ff0000 100%'];
    expectGradient(weightedStops);
    assert(nodes['#gradient-preview']['aria-label'].includes('#787878 (50%)'));
    assert(nodes['#gradient-preview']['aria-label'].includes('#0000ff (30%)'));
    assert(nodes['#gradient-preview']['aria-label'].includes('#ff0000 (20%)'));
    let finishSave;
    saveGate = new Promise(resolve => { finishSave = resolve; });
    const pendingSave = nodes['#save-gradient'].events.click();
    assert.equal(nodes['#save-gradient'].disabled, true);
    assert.deepEqual(savedGradients.at(-1).stops, [
      { hex: '#787878', offset: 0 }, { hex: '#787878', offset: .35 },
      { hex: '#0000ff', offset: .65 }, { hex: '#0000ff', offset: .7 },
      { hex: '#ff0000', offset: .9 }, { hex: '#ff0000', offset: 1 },
    ]);
    await nodes['#save-gradient'].events.click();
    await shortcut().result;
    assert.equal(savedGradients.length, 4); // No duplicate exports while encoding.
    changeMode('saturated');
    assert.equal(nodes['#save-gradient'].disabled, true);
    finishSave();
    await pendingSave;
    saveGate = undefined;
    assert.equal(nodes['#save-gradient'].disabled, false);
    await nodes['#save-gradient'].events.click();
    assert.deepEqual(savedGradients.at(-1).stops, [
      { hex: '#787878', offset: 0 }, { hex: '#0000ff', offset: .5 }, { hex: '#ff0000', offset: 1 },
    ]);
    changeMode('complimentary');
    await shortcut().result;
    assert.deepEqual(savedGradients.at(-1).stops, [{ hex: '#0000ff', offset: 0 }, { hex: '#ff0000', offset: 1 }]);
    changeMode('prominent');
    const swatches = nodes['#palette'].children;
    const pins = nodes['#markers'].children;
    const paintingSrc = nodes['#painting'].src;
    nodes['#gradient-toggle'].events.click();
    assert.equal(nodes['#gradient-preview'].hidden, true);
    assert.equal(nodes['#painting'].style.visibility, '');
    assert.equal(nodes['#markers'].hidden, false);
    assert.equal(nodes['#gradient-toggle']['aria-pressed'], 'false');
    assert.equal(nodes['#painting'].src, paintingSrc);
    assert.equal(nodes['#palette'].children, swatches);
    assert.equal(nodes['#markers'].children, pins);
    nodes['#markers-toggle'].events.click();
    assert.equal(nodes['#markers'].hidden, true);
    nodes['#gradient-toggle'].events.click();
    await nodes['#gallery'].children[0].events.click();
    expectGradient(weightedStops);
    assert.equal(nodes['#painting'].src, './images/first.png');

    // A small accent should remain a small region rather than filling half the image.
    currentSample = sample([
      ...Array.from({ length: 98 }, () => [255, 0, 0]),
      ...Array.from({ length: 2 }, () => [0, 0, 255]),
    ]);
    await upload();
    expectColors(2, 'prominent');
    expectGradient(['#ff0000 0%', '#ff0000 97%', '#0000ff 99%', '#0000ff 100%']);
    changeMode('saturated');

    currentSample = sample([
      [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255],
      [0, 0, 255], [0, 100, 70], [255, 0, 255], [0, 0, 0], [255, 255, 255],
    ]);
    await upload();
    expectColors(10, 'saturated');
    changeMode('complimentary');
    expectColors(10, 'complimentary');
    assert(nodes['#palette'].children[9].title.startsWith('Pair 5, complement'));

    nodes['#fewer-colors'].events.click();
    expectColors(9, 'complimentary');
    changeMode('prominent');
    expectColors(9, 'prominent');
    for (let i = 0; i < 12; i++) nodes['#fewer-colors'].events.click();
    expectColors(2, 'prominent');
    assert.equal(nodes['#fewer-colors'].disabled, true);
    for (let i = 0; i < 12; i++) nodes['#more-colors'].events.click();
    expectColors(10, 'prominent');
    assert.equal(nodes['#more-colors'].disabled, true);

    let release;
    decodeGate = new Promise(resolve => { release = resolve; });
    const pendingUpload = upload();
    nodes['#restart'].events.click();
    release();
    await pendingUpload;
    assert.equal(nodes['#palette'].children.length, 0);
    assert.equal(nodes['#markers'].children.length, 0);
    assert.equal(nodes['.workspace'].hidden, true);
    assert.equal(nodes['#restart'].hidden, true);
    assert.equal(nodes['#mode'].value, 'prominent');
    assert.equal(nodes['#painting'].src, undefined);
    assert.equal(nodes['#painting-upload'].focused, true);
    assert.equal(nodes['#gradient-toggle']['aria-pressed'], 'false');
    assert.equal(nodes['#gradient-toggle'].disabled, true);
    assert.equal(nodes['#gradient-preview'].hidden, true);
    assert.equal(nodes['#gradient-preview'].style.backgroundImage, '');
    assert.equal(nodes['#painting'].style.visibility, '');
    assert.equal(nodes['#markers'].hidden, false);
    assert.equal(nodes['#markers-toggle']['aria-pressed'], 'true');
    assert.equal(nodes['#markers-toggle'].disabled, true);
    assert.equal(nodes['#save-gradient'].disabled, true);
    const savedBeforeReset = savedGradients.length;
    await nodes['#save-gradient'].events.click();
    assert.equal(shortcut().event.prevented, undefined);
    assert.equal(savedGradients.length, savedBeforeReset);
    decodeGate = undefined;
    await upload();
    expectColors(10, 'prominent');
    assert.equal(nodes['#markers'].hidden, false);
    assert.equal(nodes['#markers-toggle'].disabled, false);
  } finally {
    delete globalThis.__testGradientDownload;
    nodes['#restart'].events.click();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldImage === undefined) delete globalThis.Image;
    else globalThis.Image = oldImage;
  }
});
