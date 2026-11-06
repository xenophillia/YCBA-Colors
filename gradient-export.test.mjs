import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadGradientPng } from './gradient-export.mjs';

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
