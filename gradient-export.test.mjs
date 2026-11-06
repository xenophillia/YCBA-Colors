import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadGradientPng, downloadGradientSvg, downloadGradientAse, createGradientSvg, createGradientAse } from './gradient-export.mjs';

test('PNG export paints the supplied stops at full size and numbers local day-month downloads persistently', async () => {
  const oldDocument = globalThis.document;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map([['colorpicker-exports-2026-11-3', '4']]);
  const canvases = [], links = [];
  let failEncoding = false, blockStorage = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { if (blockStorage) throw new Error('Blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockStorage) throw new Error('Blocked'); storage.set(key, value); },
    },
  });
  globalThis.document = {
    body: { append(link) { link.attached = true; } },
    createElement(tag) {
      if (tag === 'a') {
        const link = {
          click() { assert(this.attached); this.clicked = true; },
          remove() { this.attached = false; },
        };
        links.push(link);
        return link;
      }
      assert.equal(tag, 'canvas');
      const recorded = { stops: [] };
      const gradient = { addColorStop(offset, hex) { recorded.stops.push({ hex, offset }); } };
      const context = {
        createLinearGradient(...coordinates) { recorded.coordinates = coordinates; return gradient; },
        fillRect(...rect) { recorded.rect = rect; assert.equal(this.fillStyle, gradient); },
      };
      const canvas = {
        getContext(type) { assert.equal(type, '2d'); return context; },
        toBlob(callback, type) {
          recorded.type = type;
          // Canvas encoding is browser-owned. Check the requested MIME and Blob
          // download path using a known PNG fixture in this Node test.
          const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOkAAAAASUVORK5CYII=', 'base64');
          callback(failEncoding ? null : new Blob([bytes], { type }));
        },
      };
      canvases.push({ canvas, recorded });
      return canvas;
    },
  };
  const stops = [
    { hex: '#ff0000', offset: 0 }, { hex: '#ff0000', offset: .7 },
    { hex: '#0000ff', offset: .9 }, { hex: '#0000ff', offset: 1 },
  ];
  const november3 = new Date(2026, 10, 3, 14, 30);
  try {
    assert.equal(await downloadGradientPng(stops, 1200, 1800, november3), 'Colortest_3-11_5.png');
    assert.equal(canvases[0].canvas.width, 1200);
    assert.equal(canvases[0].canvas.height, 1800);
    assert.deepEqual(canvases[0].recorded, {
      stops, coordinates: [0, 0, 0, 1800], rect: [0, 0, 1200, 1800], type: 'image/png',
    });
    assert.equal(links[0].download, 'Colortest_3-11_5.png');
    assert.equal(links[0].clicked, true);
    assert.equal(links[0].attached, false);
    assert(links[0].href.startsWith('blob:'));
    const blob = await (await fetch(links[0].href)).blob();
    assert.equal(blob.type, 'image/png');
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(await downloadGradientPng(stops, 1200, 1800, november3), 'Colortest_3-11_6.png');

    // A fresh module models refreshing the page: numbering continues from storage.
    const refreshed = await import('./gradient-export.mjs?fresh-session');
    assert.equal(await refreshed.downloadGradientPng(stops, 1200, 1800, november3), 'Colortest_3-11_7.png');
    assert.equal(await downloadGradientPng(stops, 1200, 1800, new Date(2026, 10, 4)), 'Colortest_4-11_1.png');

    blockStorage = true;
    const november5 = new Date(2026, 10, 5);
    assert.equal(await downloadGradientPng(stops, 1200, 1800, november5), 'Colortest_5-11_1.png');
    assert.equal(await downloadGradientPng(stops, 1200, 1800, november5), 'Colortest_5-11_2.png');

    const beforeFailure = links.length;
    failEncoding = true;
    await assert.rejects(downloadGradientPng(stops, 1200, 1800, new Date(2026, 10, 6)), /encode/);
    assert.equal(links.length, beforeFailure);
    failEncoding = false;
    assert.equal(await downloadGradientPng(stops, 1200, 1800, new Date(2026, 10, 6)), 'Colortest_6-11_1.png');
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
  }
});

test('SVG contains an editable vertical gradient with exact colors, offsets, dimensions, and hard stops', () => {
  const stops = Object.freeze([
    { hex: '#123456', offset: 0 },
    { hex: '#123456', offset: .123456789012345 },
    { hex: '#abcdef', offset: .75 },
    { hex: '#FFFFFF', offset: .75 },
    { hex: '#FFFFFF', offset: 1 },
  ].map(Object.freeze));
  const svg = createGradientSvg(stops, 1200, 1800);
  assert(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(svg.includes('xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800"'));
  assert(svg.includes('gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1800"'));
  assert(svg.includes('color-interpolation="sRGB" spreadMethod="pad"'));
  assert(svg.includes('fill="url(#palette-gradient)"'));
  assert(!svg.includes('<image'));
  const parsed = [...svg.matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"\/>/g)]
    .map(([, offset, hex]) => ({ hex, offset: Number(offset) }));
  assert.deepEqual(parsed, stops);
});

function decodeAse(bytes) {
  // Use Node Buffer reads to independently check the DataView-based writer.
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.toString('ascii', 0, 4), 'ASEF');
  assert.equal(buffer.readUInt16BE(4), 1);
  assert.equal(buffer.readUInt16BE(6), 0);
  const count = buffer.readUInt32BE(8), swatches = [], groups = [];
  let cursor = 12, depth = 0;
  for (let block = 0; block < count; block++) {
    const type = buffer.readUInt16BE(cursor);
    const end = cursor + 6 + buffer.readUInt32BE(cursor + 2);
    assert(end <= buffer.length);
    cursor += 6;
    if (type === 0xc002) {
      depth--;
      assert.equal(cursor, end);
      continue;
    }
    const units = buffer.readUInt16BE(cursor);
    cursor += 2;
    assert(units > 0);
    let name = '';
    for (let i = 0; i < units - 1; i++) { name += String.fromCharCode(buffer.readUInt16BE(cursor)); cursor += 2; }
    assert.equal(buffer.readUInt16BE(cursor), 0);
    cursor += 2;
    if (type === 0xc001) {
      groups.push(name);
      depth++;
    } else {
      assert.equal(type, 0x0001);
      assert.equal(depth, 1);
      assert.equal(buffer.toString('ascii', cursor, cursor + 4), 'RGB ');
      cursor += 4;
      const rgb = [];
      for (let channel = 0; channel < 3; channel++) {
        const value = buffer.readFloatBE(cursor);
        assert(value >= 0 && value <= 1);
        rgb.push(Math.round(value * 255));
        cursor += 4;
      }
      assert.equal(buffer.readUInt16BE(cursor), 2, 'Expected normal/process swatches');
      cursor += 2;
      swatches.push({ name, rgb });
    }
    assert.equal(cursor, end, 'ASE block length must match its payload');
  }
  assert.equal(depth, 0);
  assert.equal(cursor, buffer.length, 'No trailing or uncounted ASE bytes');
  return { count, groups, swatches };
}

test('ASE preserves every stop as an ordered RGB process swatch with a named position', () => {
  const stops = [
    { hex: '#123456', offset: 0 }, { hex: '#123456', offset: .35 },
    { hex: '#abcdef', offset: .75 }, { hex: '#000000', offset: .75 }, { hex: '#FFFFFF', offset: 1 },
  ];
  const decoded = decodeAse(createGradientAse(stops));
  assert.equal(decoded.count, stops.length + 2);
  assert.deepEqual(decoded.groups, ['YCBA Colors']);
  assert.deepEqual(decoded.swatches, [
    { name: 'Stop 01 #123456 @ 0%', rgb: [18, 52, 86] },
    { name: 'Stop 02 #123456 @ 35%', rgb: [18, 52, 86] },
    { name: 'Stop 03 #abcdef @ 75%', rgb: [171, 205, 239] },
    { name: 'Stop 04 #000000 @ 75%', rgb: [0, 0, 0] },
    { name: 'Stop 05 #FFFFFF @ 100%', rgb: [255, 255, 255] },
  ]);
  const twentyStops = Array.from({ length: 20 }, (_, index) => ({ hex: index % 2 ? '#ffffff' : '#000000', offset: index / 19 }));
  assert.equal(decodeAse(createGradientAse(twentyStops)).swatches.length, 20);
  const singleColor = [{ hex: '#ff0000', offset: 0 }, { hex: '#ff0000', offset: 1 }];
  assert.equal(decodeAse(createGradientAse(singleColor)).swatches.length, 2);
});

test('SVG and ASE downloads use the requested extensions and continue the shared daily numbering', async () => {
  const oldDocument = globalThis.document;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const links = [], stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } });
  globalThis.document = {
    body: { append() {} },
    createElement(tag) {
      assert.equal(tag, 'a', 'SVG and ASE exports should not rasterize through canvas');
      const link = { click() { links.push(this); }, remove() {} };
      return link;
    },
  };
  const stops = [{ hex: '#123456', offset: 0 }, { hex: '#abcdef', offset: 1 }];
  const date = new Date(2026, 10, 9);
  try {
    assert.equal(downloadGradientSvg(stops, 1200, 1800, date), 'Colortest_9-11_1.svg');
    assert.equal(downloadGradientAse(stops, 1200, 1800, date), 'Colortest_9-11_2.ase');
    const svgBlob = await (await fetch(links[0].href)).blob();
    assert(svgBlob.type.startsWith('image/svg+xml'));
    assert.equal(await svgBlob.text(), createGradientSvg(stops, 1200, 1800));
    const aseBlob = await (await fetch(links[1].href)).blob();
    assert.equal(aseBlob.type, 'application/octet-stream');
    assert.equal(decodeAse(new Uint8Array(await aseBlob.arrayBuffer())).swatches.length, 2);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
  }
});

test('exporters reject malformed stops and SVG dimensions before serializing them', () => {
  for (const stops of [
    [], [{ hex: '#fff', offset: 0 }], [{ hex: '#000000', offset: NaN }],
    [{ hex: '#000000', offset: -1 }], [{ hex: '#000000', offset: 2 }],
    [{ hex: '#000000', offset: 1 }, { hex: '#ffffff', offset: 0 }],
  ]) {
    assert.throws(() => createGradientSvg(stops, 1200, 1800));
    assert.throws(() => createGradientAse(stops));
  }
  assert.throws(() => createGradientSvg([{ hex: '#000000', offset: 0 }], '1200"', 1800), /dimensions/);
});
