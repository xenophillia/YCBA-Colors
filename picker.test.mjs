import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  value = '';
  hidden = false;
  children = [];
  style = {};
  events = {};
  captures = new Set();
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
  focus() { this.focused = true; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 100, top: 200, width: 400, height: 200 }; }
}

const sample = colors => ({ width: colors.length, height: 1, data: new Uint8ClampedArray(colors.flatMap(rgb => [...rgb, 255])) });

test('dots pick original pixels live with mouse, touch, keyboard, bounds, copy, and preview updates', async () => {
  const oldDocument = globalThis.document, oldImage = globalThis.Image;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const nodes = Object.fromEntries(['#painting-upload', '#painting', '.workspace', '#markers', '#palette', '#status', '#mode', '#restart', '#more-colors', '#fewer-colors', '#gallery', '#gallery-toggle', '#gradient-toggle', '#gradient-preview', '#markers-toggle', '#save-gradient', 'main'].map(id => [id, new Element()]));
  const exported = [];
  globalThis.__pickerGradientDownload = async (stops, width, height) => { exported.push({ stops: structuredClone(stops), width, height }); };
  nodes['#mode'].value = 'prominent';
  const copied = [], reads = [];
  let fixture = {
    width: 4, height: 2,
    pixels: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
      20, 40, 60, 255, 255, 255, 255, 255, 0, 255, 255, 255, 123, 40, 20, 0,
    ]),
    // Deliberately simpler than the original: picking must not use analysis RGB.
    analysis: sample([[255, 0, 0], [0, 0, 255]]),
  };
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = fixture.width;
      this.naturalHeight = fixture.height;
      this.pixels = fixture.pixels;
      this.analysis = fixture.analysis;
    }
    async decode() {}
  };
  globalThis.document = {
    addEventListener() {},
    querySelector: id => nodes[id],
    createElement: tag => {
      if (tag !== 'canvas') return new Element();
      let draw, filledWhite = false;
      const context = {
        drawImage(...args) { draw = args; },
        fillRect() { filledWhite = context.fillStyle === '#fff'; },
        getImageData() {
          const [source, x, y] = draw;
          if (draw.length !== 9) return source.analysis;
          assert(filledWhite, 'Transparent pixels must be composited over white');
          assert(x >= 0 && x < source.naturalWidth && y >= 0 && y < source.naturalHeight);
          reads.push([x, y]);
          const offset = (y * source.naturalWidth + x) * 4;
          const rgba = source.pixels.slice(offset, offset + 4);
          const alpha = rgba[3] / 255;
          return { data: new Uint8ClampedArray([
            ...[...rgba.slice(0, 3)].map(v => Math.round(v * alpha + 255 * (1 - alpha))), 255,
          ]) };
        },
      };
      return { getContext: () => context };
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(hex) { copied.push(hex); } } } });
  const pointer = (marker, type, x, y, extra = {}) => {
    const event = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, preventDefault() { this.prevented = true; }, ...extra };
    marker.events[type](event);
    return event;
  };
  const key = (marker, name, shiftKey = false) => {
    const event = { key: name, shiftKey, preventDefault() { this.prevented = true; } };
    marker.events.keydown(event);
    return event;
  };
  try {
    const source = (await readFile(new URL('./app.js', import.meta.url), 'utf8'))
      .replace("'./palette.mjs'", JSON.stringify(new URL('./palette.mjs', import.meta.url).href))
      .replace("import { downloadGradientPng } from './gradient-export.mjs';", 'const downloadGradientPng = globalThis.__pickerGradientDownload;')
      .replace(/import \{ galleryImages \} from '\.\/gallery-images\.mjs(?:\?[^']*)?';/, "const galleryImages = ['./first.png', './second.png'];");
    await import('data:text/javascript,' + encodeURIComponent(source));
    await Promise.resolve();
    const [first, second] = nodes['#markers'].children;
    const [swatch, otherSwatch] = nodes['#palette'].children;
    assert.equal(swatch.style.backgroundColor, '#ff0000');
    assert.equal(otherSwatch.style.backgroundColor, '#0000ff');

    pointer(first, 'pointermove', 450, 250);
    pointer(first, 'pointerdown', 206, 304, { button: 2 });
    assert.equal(reads.length, 0);
    assert(pointer(first, 'pointerdown', 206, 304).prevented);
    assert(first.hasPointerCapture(1));
    pointer(first, 'pointermove', 456, 254, { pointerId: 2 });
    assert.equal(reads.length, 0);
    pointer(first, 'pointermove', 456, 254);
    assert.deepEqual(reads.at(-1), [3, 0]);
    assert.equal(swatch.style.backgroundColor, '#ffff00');
    assert.equal(swatch.children[0].textContent, '#ffff00');
    assert(swatch.title.endsWith('#ffff00'));
    assert(first['aria-label'].includes('#ffff00'));
    assert.equal(first.style.left, '87.5%');
    assert.equal(first.style.top, '25%');
    assert.equal(otherSwatch.style.backgroundColor, '#0000ff');
    assert(nodes['#gradient-preview'].style.backgroundImage.includes('#ffff00'));
    pointer(first, 'pointerup', 456, 254);
    await nodes['#save-gradient'].events.click();
    assert.deepEqual(exported[0], { width: 4, height: 2, stops: [
      { hex: '#ffff00', offset: 0 }, { hex: '#ffff00', offset: .25 },
      { hex: '#0000ff', offset: .75 }, { hex: '#0000ff', offset: 1 },
    ] });
    assert(!first.hasPointerCapture(1));
    assert.equal(first['data-dragging'], undefined);

    await swatch.events.click();
    assert.deepEqual(copied, ['#ffff00']);
    assert.equal(swatch.children[0].textContent, 'Copied!');
    assert(key(first, 'ArrowLeft').prevented);
    assert.equal(swatch.style.backgroundColor, '#0000ff');
    assert.equal(swatch.children[0].textContent, '#0000ff');
    key(first, 'ArrowDown');
    assert.equal(swatch.style.backgroundColor, '#00ffff');
    key(first, 'ArrowRight');
    assert.equal(swatch.style.backgroundColor, '#ffffff');
    key(first, 'ArrowLeft', true);
    assert.equal(swatch.style.backgroundColor, '#14283c');
    assert.equal(first.style.left, '12.5%');

    pointer(first, 'pointerdown', 150, 350);
    pointer(first, 'pointermove', -1000, -1000);
    assert.deepEqual(reads.at(-1), [0, 0]);
    assert.equal(swatch.style.backgroundColor, '#ff0000');
    pointer(first, 'pointercancel', 450, 350);
    assert(!first.hasPointerCapture(1));
    pointer(first, 'pointermove', 450, 350);
    assert.equal(swatch.style.backgroundColor, '#ff0000');

    pointer(second, 'pointerdown', 400, 300, { pointerId: 3, pointerType: 'touch' });
    pointer(second, 'pointermove', 5000, 5000, { pointerId: 3, pointerType: 'touch' });
    assert.deepEqual(reads.at(-1), [3, 1]);
    assert.equal(otherSwatch.style.backgroundColor, '#ffffff');
    assert.equal(second.style.left, '87.5%');
    assert.equal(second.style.top, '75%');
    pointer(second, 'pointerup', 5000, 5000, { pointerId: 3, pointerType: 'touch' });

    nodes['#gradient-toggle'].events.click();
    assert(nodes['#gradient-preview'].style.backgroundImage.includes('#ff0000'));
    assert(nodes['#gradient-preview'].style.backgroundImage.includes('#ffffff'));
    const readCount = reads.length;
    key(first, 'ArrowRight');
    assert.equal(reads.length, readCount);
    nodes['#gradient-toggle'].events.click();
    nodes['#markers-toggle'].events.click();
    pointer(first, 'pointerdown', 150, 250);
    assert(!first.hasPointerCapture(1));
    nodes['#markers-toggle'].events.click();
    assert.equal(swatch.style.backgroundColor, '#ff0000');
    assert.equal(otherSwatch.style.backgroundColor, '#ffffff');

    nodes['#mode'].value = 'saturated';
    nodes['#mode'].events.change();
    assert.equal(nodes['#palette'].children[1].style.backgroundColor, '#0000ff');
    key(first, 'ArrowRight'); // Detached controls cannot update the new palette.
    assert.equal(reads.length, readCount);
    fixture = { width: 2, height: 1, pixels: new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 0, 255]), analysis: sample([[0, 255, 0]]) };
    await nodes['#gallery'].children[1].events.click();
    const newMarker = nodes['#markers'].children[0];
    pointer(newMarker, 'pointerdown', 300, 300);
    pointer(newMarker, 'pointermove', 450, 300);
    assert.equal(nodes['#palette'].children[0].style.backgroundColor, '#000000');
    pointer(newMarker, 'pointerup', 450, 300);
    nodes['#restart'].events.click();
    const readsBeforeReset = reads.length;
    key(newMarker, 'ArrowLeft');
    assert.equal(reads.length, readsBeforeReset);
    assert.equal(nodes['#palette'].children.length, 0);
    assert.equal(nodes['#gradient-preview'].style.backgroundImage, '');
  } finally {
    delete globalThis.__pickerGradientDownload;
    nodes['#restart'].events.click();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldImage === undefined) delete globalThis.Image;
    else globalThis.Image = oldImage;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});
