import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette } from './palette.mjs';

function image(regions) {
  const width = regions.reduce((n, [, count]) => n + count, 0);
  const data = new Uint8ClampedArray(width * 4);
  let pixel = 0;
  for (const [rgb, count] of regions) {
    for (let i = 0; i < count; i++) data.set([...rgb, 255], pixel++ * 4);
  }
  return { data, width };
}

function palette(regions, mode) {
  const { data, width } = image(regions);
  const result = extractPalette(data, width, 1, mode);
  assert(result.length >= 1 && result.length <= 10);
  assert.equal(new Set(result.map(p => p.rgb.join(','))).size, result.length);
  for (const color of result) {
    const offset = Math.floor(color.x * width) * 4;
    assert.deepEqual(color.rgb, [...data.slice(offset, offset + 3)]);
    assert.equal(color.y, .5);
  }
  return result.map(p => p.rgb);
}

test('complimentary mode pairs red with green and orange with blue, despite a dominant gray background', () => {
  const red = [255, 0, 0], green = [0, 255, 0], orange = [255, 128, 0], blue = [0, 0, 255];
  const colors = palette([[[120, 120, 120], 1000], [red, 100], [green, 100], [orange, 100], [blue, 100]], 'complimentary');
  assert.deepEqual(colors, [red, green, orange, blue]);
});

test('complementary hue matching wraps around the end of the wheel', () => {
  const red = [255, 0, 5], green = [0, 240, 5];
  const colors = palette([[red, 100], [green, 100], [[230, 115, 0], 100], [[0, 0, 230], 100]], 'complimentary');
  assert.deepEqual(colors.slice(0, 2), [red, green]);
});

test('missing complements use the closest available chromatic hue', () => {
  const red = [255, 0, 0], orange = [230, 100, 0], greenYellow = [140, 220, 0];
  const colors = palette([[red, 100], [orange, 100], [greenYellow, 100], [[245, 245, 245], 100]], 'complimentary');
  assert.deepEqual(colors.slice(0, 2), [red, greenYellow]);
  assert.equal(new Set(colors.map(c => c.join(','))).size, 4);
});

test('all modes adapt to one-, two-, and three-color images without duplicate swatches', () => {
  for (const mode of ['prominent', 'saturated', 'complimentary']) {
    for (const colors of [
      [[0, 0, 0]],
      [[255, 0, 0], [0, 255, 0]],
      [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
      [[0, 0, 0], [80, 80, 80], [160, 160, 160], [255, 255, 255]],
    ]) {
      const result = palette(colors.map(c => [c, 10]), mode);
      const count = colors.length === 4 ? 2 : mode === 'complimentary' && colors.length === 3 ? 2 : colors.length;
      assert.equal(result.length, count);
    }
    assert.throws(() => extractPalette(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1, mode), /no visible pixels/);
  }
});

test('prominent and saturated modes still prioritize coverage and vivid accents respectively', () => {
  const muted = [[45, 45, 45], [90, 90, 90], [140, 140, 140], [200, 200, 200]];
  const vivid = [[240, 20, 30], [20, 220, 40], [30, 40, 240], [240, 210, 15]];
  const regions = [...muted.map(c => [c, 2400]), ...vivid.map(c => [c, 100])];
  const prominent = palette(regions, 'prominent');
  assert(prominent.some(rgb => Math.max(...rgb) - Math.min(...rgb) < 10));
  const saturated = palette(regions, 'saturated');
  assert.deepEqual(new Set(saturated.slice(0, 4).map(c => c.join(','))), new Set(vivid.map(c => c.join(','))));
});

test('small shade variations and a smooth grayscale gradient produce compact palettes', () => {
  const nearBlue = [[30, 50, 110], [32, 52, 112], [28, 48, 108], [34, 54, 114]];
  const grayGradient = Array.from({ length: 256 }, (_, v) => [[v, v, v], 10]);
  for (const mode of ['prominent', 'saturated', 'complimentary']) {
    assert.equal(palette(nearBlue.map(c => [c, 100]), mode).length, 1);
    assert.equal(palette(grayGradient, mode).length, 2);
  }
});

test('broad single-hue shading stays at one or two colors', () => {
  const ramps = [v => [0, 0, v], v => [v, 0, 0], v => [v, Math.round(v * .65), Math.round(v * .3)]];
  for (const ramp of ramps) {
    const regions = Array.from({ length: 256 }, (_, v) => [ramp(v), 10]);
    for (const mode of ['prominent', 'saturated', 'complimentary']) {
      assert(palette(regions, mode).length <= 2);
    }
  }
});

test('tonal simplification preserves a vivid accent across a neutral background', () => {
  const grays = [20, 70, 120, 170, 220].map(v => [[v, v, v], 1980]);
  const red = [255, 0, 0];
  for (const mode of ['prominent', 'saturated', 'complimentary']) {
    const colors = palette([...grays, [red, 100]], mode);
    assert.equal(colors.length, 2);
    assert(colors.some(c => c.join(',') === red.join(',')));
  }
});

test('rich paintings can produce ten colors, and larger palettes stay capped', () => {
  const distinct = [
    [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255],
    [0, 0, 255], [0, 100, 70], [255, 0, 255], [0, 0, 0], [255, 255, 255],
  ];
  for (const mode of ['prominent', 'saturated', 'complimentary']) {
    assert.equal(palette(distinct.map(c => [c, 100]), mode).length, 10);
    const result = palette([...distinct, [80, 130, 100], [160, 70, 80]].map(c => [c, 100]), mode);
    assert(result.length <= 10);
  }
});

test('isolated vivid noise is ignored, but a small recurring accent survives', () => {
  const gray = [120, 120, 120], red = [255, 0, 0];
  for (const mode of ['prominent', 'saturated', 'complimentary']) {
    assert.deepEqual(palette([[gray, 9999], [red, 1]], mode), [gray]);
    const accented = palette([[gray, 9950], [red, 50]], mode);
    assert.equal(accented.length, 2);
    assert(accented.some(c => c.join(',') === red.join(',')));
  }
});

test('complimentary mode rounds odd multi-color palettes down to complete pairs', () => {
  const regions = [[[255, 0, 0], 100], [[0, 255, 0], 100], [[0, 0, 255], 100]];
  assert.equal(palette(regions, 'prominent').length, 3);
  assert.equal(palette(regions, 'saturated').length, 3);
  assert.equal(palette(regions, 'complimentary').length, 2);
});


test('automatic selection retains distinct warm, green, blue, and purple paint colors', () => {
  const colors = [[160, 110, 100], [145, 135, 95], [110, 140, 115], [100, 120, 150], [140, 105, 140]];
  for (const mode of ['prominent', 'saturated']) {
    const result = palette(colors.map(c => [c, 100]), mode);
    assert.equal(result.length, 5);
    assert.deepEqual(new Set(result.map(c => c.join(','))), new Set(colors.map(c => c.join(','))));
  }
});

test('a tiny outlier does not prevent detection of the main painting colors', () => {
  const colors = [[160, 110, 100], [145, 135, 95], [110, 140, 115], [100, 120, 150], [140, 105, 140]];
  const result = palette([...colors.map(c => [c, 2000]), [[0, 255, 0], 1]], 'prominent');
  assert(result.length >= 5);
  assert(!result.some(c => c.join(',') === '0,255,0'));
});

function painting(width, height, pixel) {
  return new Uint8ClampedArray(Array.from({ length: width * height }, (_, i) => {
    const color = pixel(i % width, Math.floor(i / width));
    return color.length === 4 ? color : [...color, 255];
  }).flat());
}

function spatialPalette(data, width, height, mode, count) {
  const result = extractPalette(data, width, height, mode, count);
  assert(result.length >= 1 && result.length <= 10);
  assert.equal(new Set(result.map(p => p.rgb.join(','))).size, result.length);
  for (const p of result) {
    const offset = (Math.floor(p.y * height) * width + Math.floor(p.x * width)) * 4;
    assert.deepEqual(p.rgb, [...data.slice(offset, offset + 3)]);
    assert(data[offset + 3] >= 128);
  }
  return result;
}

test('squinting groups fine brushwork into broad masses and keeps original swatches', () => {
  const data = painting(60, 40, (x, y) => x < 30
    ? (x + y) % 2 ? [180, 70, 60] : [210, 100, 90]
    : (x + y) % 2 ? [60, 100, 160] : [90, 130, 190]);
  const result = spatialPalette(data, 60, 40, 'prominent');
  assert.equal(result.length, 2);
  assert(result.some(p => p.rgb[0] > p.rgb[2]));
  assert(result.some(p => p.rgb[2] > p.rgb[0]));
});

test('saturated selection preserves a small coherent accent and ignores an isolated vivid pixel', () => {
  const data = painting(60, 40, (x, y) => {
    if (x >= 15 && x < 19 && y >= 15 && y < 19) return [255, 20, 20];
    if (x === 50 && y === 30) return [0, 255, 0];
    return x < 30 ? [160, 110, 100] : [100, 120, 150];
  });
  const prominent = spatialPalette(data, 60, 40, 'prominent');
  assert.notDeepEqual(prominent[0].rgb, [255, 20, 20]);
  const saturated = spatialPalette(data, 60, 40, 'saturated');
  assert.deepEqual(saturated[0].rgb, [255, 20, 20]);
  assert(!saturated.some(p => p.rgb.join(',') === '0,255,0'));
  const limited = spatialPalette(data, 60, 40, 'saturated', 2);
  assert.equal(limited.length, 2);
  assert.deepEqual(limited[0].rgb, [255, 20, 20]);
});

test('transparent hidden colors do not contaminate the blurred palette', () => {
  const data = painting(30, 30, (x, y) => x > 5 && x < 25 && y > 5 && y < 25
    ? [50, 100, 160, 255] : [255, 0, 0, 0]);
  const result = spatialPalette(data, 30, 30, 'saturated');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rgb, [50, 100, 160]);
});

test('limited saturated and complimentary palettes cover different hues despite dominant red shades', () => {
  const data = painting(100, 60, x => {
    if (x < 20) return [250, 10, 10];
    if (x < 40) return [180, 5, 15];
    if (x < 60) return [120, 5, 10];
    if (x < 80) return [240, 55, 45];
    if (x < 90) return [65, 150, 85];
    return [65, 95, 155];
  });
  for (const mode of ['saturated', 'complimentary']) {
    const result = spatialPalette(data, 100, 60, mode, 3);
    assert.equal(result.length, 3);
    assert(result.some(p => p.rgb[0] > p.rgb[1] * 2));
    assert(result.some(p => p.rgb[1] > p.rgb[0] && p.rgb[1] > p.rgb[2]));
    assert(result.some(p => p.rgb[2] > p.rgb[0] && p.rgb[2] > p.rgb[1]));
  }
});

test('saturated mode favors a lighter vivid shade over dark saturated paint and white', () => {
  const light = [255, 110, 100];
  const data = painting(60, 40, x => x < 20 ? [150, 5, 5] : x < 40 ? light : [245, 245, 245]);
  const result = spatialPalette(data, 60, 40, 'saturated', 2);
  assert.deepEqual(result[0].rgb, light);
});

test('saturated hue range outranks additional bright warm shades', () => {
  const blue = [20, 35, 95];
  const data = painting(100, 40, x => x < 30 ? [255, 100, 100]
    : x < 60 ? [255, 145, 100] : x < 90 ? [255, 100, 150] : blue);
  const result = spatialPalette(data, 100, 40, 'saturated', 2);
  assert.equal(result.length, 2);
  assert(result.some(p => p.rgb.join(',') === blue.join(',')));
  assert(result.some(p => p.rgb[0] === 255));
});
