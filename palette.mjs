// Cluster in perceptual Lab space so similar shades count as one color family.
function lab(r, g, b) {
  const linear = v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  r = linear(r); g = linear(g); b = linear(b);
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((r * .4124564 + g * .3575761 + b * .1804375) / .95047);
  const y = f(r * .2126729 + g * .7151522 + b * .072175);
  const z = f((r * .0193339 + g * .119192 + b * .9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const saturationScore = rgb => {
  const high = Math.max(...rgb), low = Math.min(...rgb);
  // HSV saturation with a brightness weight prevents near-black pixels from winning.
  return high ? (high - low) / high * Math.sqrt(high / 255) : 0;
};

// These thresholds control how much detail deserves its own swatch.
const MAX_COLORS = 10;
const DISTINCT_DISTANCE = 10;
const MIN_COVERAGE = .008;
const MIN_ACCENT_COVERAGE = .0015;
// Reduce the influence of lighting/shading when counting color families.
const familyDistance = (a, b) => (.35 * (a[0] - b[0])) ** 2
  + (.75 * (a[1] - b[1])) ** 2 + (.75 * (a[2] - b[2])) ** 2;

function summarize(points) {
  const count = points.reduce((sum, p) => sum + p.count, 0);
  const center = [0, 0, 0], rgb = [0, 0, 0];
  for (const p of points) {
    for (let c = 0; c < 3; c++) {
      center[c] += p.lab[c] * p.count / count;
      rgb[c] += p.rgb[c] * p.count / count;
    }
  }
  const error = points.reduce((sum, p) => sum + familyDistance(p.lab, center) * p.count, 0);
  return { points, count, center, rgb, error };
}

function splitFamily(group, total, forced = false) {
  if (group.points.length < 2 || group.error < .001) return;
  // Try several starting colors: one rare outlier must not veto a rich palette.
  const first = group.points.reduce((best, p) => p.count > best.count ? p : best);
  const seeds = [...group.points].sort((a, b) =>
    familyDistance(b.lab, first.lab) * Math.sqrt(b.count)
    - familyDistance(a.lab, first.lab) * Math.sqrt(a.count)).slice(0, 4);
  let best;
  for (const second of seeds) {
    const split = fitSplit(group, total, forced, first, second);
    if (split && (!best || split.gain > best.gain)) best = split;
  }
  return best;
}

function fitSplit(group, total, forced, first, second) {
  let centers = [first.lab, second.lab], children;
  for (let iteration = 0; iteration < 20; iteration++) {
    const buckets = [[], []];
    for (const p of group.points) {
      const index = familyDistance(p.lab, centers[0]) <= familyDistance(p.lab, centers[1]) ? 0 : 1;
      buckets[index].push(p);
    }
    if (buckets.some(bucket => !bucket.length)) return;
    children = buckets.map(summarize);
    const movement = children.reduce((sum, child, i) => sum + familyDistance(child.center, centers[i]), 0);
    centers = children.map(child => child.center);
    if (movement < .001) break;
  }
  const separation = Math.sqrt(familyDistance(...centers));
  const gain = group.error - children.reduce((sum, child) => sum + child.error, 0);
  if (forced) return gain > 0 ? { children, gain } : undefined;
  if (separation < DISTINCT_DISTANCE || gain <= 0) return;
  // A rare accent can explain little total variance while still being distinctive.
  if (gain / group.error < .15 && separation < 24) return;
  // Small vivid accents qualify at a lower coverage than ordinary color groups.
  const meaningful = children.every(child => child.count / total >= MIN_COVERAGE
    || (child.count / total >= MIN_ACCENT_COVERAGE && saturationScore(child.rgb) >= .4 && separation >= 24));
  if (!meaningful) return;
  if (Math.sqrt(group.error / group.count) < 4.5 && separation < 24) return;
  return { children, gain };
}

function colorFamilies(points, count) {
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const root = summarize(points);
  const groups = [root];
  const splits = new Map([[root, splitFamily(root, total, count !== undefined)]]);
  while (groups.length < (count ?? MAX_COLORS)) {
    let parent, best;
    for (const group of groups) {
      const split = splits.get(group);
      if (split && (!best || split.gain > best.gain)) { parent = group; best = split; }
    }
    if (!best) break;
    groups.splice(groups.indexOf(parent), 1, ...best.children);
    splits.delete(parent);
    for (const child of best.children) splits.set(child, splitFamily(child, total, count !== undefined));
  }
  if (count !== undefined) return groups.sort((a, b) => b.count - a.count);
  // Neighboring branches can converge on similar colors; collapse those duplicates.
  while (groups.length > 1) {
    let pair, nearest = DISTINCT_DISTANCE ** 2;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = familyDistance(groups[i].center, groups[j].center);
        if (d < nearest) { nearest = d; pair = [i, j]; }
      }
    }
    if (!pair) break;
    const [i, j] = pair;
    groups[i] = summarize([...groups[i].points, ...groups[j].points]);
    groups.splice(j, 1);
  }
  groups.sort((a, b) => b.count - a.count);
  // A painting using a single hue needs tonal representatives, not many shades.
  const chromatic = points.filter(p => saturationScore(p.rgb) >= .08 && Math.max(...p.rgb) - Math.min(...p.rgb) >= 12);
  let hueAnchor, strongest = -1;
  for (const p of chromatic) {
    const strength = p.count * saturationScore(p.rgb);
    if (strength > strongest) { hueAnchor = p; strongest = strength; }
  }
  const otherHues = hueAnchor ? chromatic.reduce((sum, p) => sum
    + (hueDistance(artistHue(p.rgb), artistHue(hueAnchor.rgb)) > 30 ? p.count : 0), 0) : 0;
  if (groups.length > 2 && otherHues / total < MIN_ACCENT_COVERAGE) {
    const primary = groups[0];
    let secondary, bestScore = -1;
    for (const group of groups.slice(1)) {
      // Preserve a vivid accent even when most of a monochromatic work is neutral.
      const score = familyDistance(group.center, primary.center)
        * (.25 + .75 * saturationScore(group.rgb)) * Math.sqrt(group.count / total);
      if (score > bestScore) { secondary = group; bestScore = score; }
    }
    const buckets = [[], []];
    for (const group of groups) {
      const index = familyDistance(group.center, primary.center) <= familyDistance(group.center, secondary.center) ? 0 : 1;
      buckets[index].push(...group.points);
    }
    return buckets.map(summarize).sort((a, b) => b.count - a.count);
  }
  return groups;
}

// Keep saturation meaningful while giving perceptual lightness more influence.
const lightSaturationScore = p => Math.sqrt(saturationScore(p.rgb))
  * (.15 + .85 * Math.max(0, Math.min(1, p.lab[0] / 100))) ** 2;

function representative(group, saturated, spatial = false, lighter = false) {
  let best, bestScore = -Infinity;
  for (const p of group.points) {
    const d = Math.sqrt(familyDistance(p.lab, group.center));
    // Prefer vivid colors with neighboring support; otherwise stay near the family center.
    const vividness = lighter ? lightSaturationScore(p) : saturationScore(p.rgb);
    const supported = p.support >= 3 && p.count >= group.count * .0015;
    const score = saturated && spatial && supported
      ? 2 + vividness
      : saturated && d <= DISTINCT_DISTANCE
      ? vividness + .03 * Math.sqrt(p.count / group.count) - .2 * d / DISTINCT_DISTANCE
      : -1 - d;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return { ...best, count: group.count };
}

function saturatedPick(candidates, selected, lighter = false) {
  let best, bestScore = -1;
  const maxCount = Math.max(...candidates.map(p => p.count));
  for (const p of candidates) {
    if (selected.includes(p)) continue;
    const separation = selected.length ? Math.min(...selected.map(s => distance(p.lab, s.lab))) : Infinity;
    const chromatic = selected.filter(s => saturationScore(s.rgb) >= .08);
    const hueGap = chromatic.length && saturationScore(p.rgb) >= .08
      ? Math.min(...chromatic.map(s => hueDistance(artistHue(p.rgb), artistHue(s.rgb)))) : 180;
    // Cover prominent hue families before spending slots on another shade of one hue.
    const hueVariety = .08 + .92 * Math.min(1, (hueGap / 35) ** 2);
    const diversity = Math.min(1, separation / (25 * 25));
    const prominence = .8 + .2 * Math.sqrt(p.count / maxCount);
    const quality = ((lighter ? lightSaturationScore(p) : saturationScore(p.rgb)) + .001)
      * diversity * hueVariety * prominence;
    // In Saturated mode, an unrepresented hue outranks a brighter repeat.
    // Retain brightness as the deciding factor within a hue family.
    const newHue = saturationScore(p.rgb) >= .12 && hueGap >= 45;
    const rangeBonus = lighter && chromatic.length && newHue
      ? 2 + 1.5 * Math.min(1, hueGap / 180) : 0;
    const score = quality + rangeBonus;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

function artistHue(rgb) {
  const [r, g, b] = rgb;
  const high = Math.max(...rgb), delta = high - Math.min(...rgb);
  if (!delta) return 0;
  let hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  // Map RGB hue to a traditional painting wheel: red–green, orange–blue, yellow–purple.
  const stops = [[0, 0], [60, 120], [120, 180], [180, 210], [240, 240], [300, 300], [360, 360]];
  for (let i = 1; i < stops.length; i++) {
    const [start, from] = stops[i - 1], [end, to] = stops[i];
    if (hue <= end) return from + (hue - start) / (end - start) * (to - from);
  }
}

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function complementaryPick(candidates, anchor, selected) {
  const available = candidates.filter(p => !selected.includes(p));
  if (!available.length) return;
  const chromatic = available.filter(p => saturationScore(p.rgb) >= .05 && Math.max(...p.rgb) - Math.min(...p.rgb) >= 12);
  if (!chromatic.length) return saturatedPick(available, []);
  const target = (artistHue(anchor.rgb) + 180) % 360;
  const maxCount = Math.max(...chromatic.map(p => p.count));
  let best, bestScore = Infinity;
  for (const p of chromatic) {
    // Opposite hue takes priority; vividness resolves close hue matches.
    const previous = selected.filter(s => s !== anchor && saturationScore(s.rgb) >= .08);
    const gap = previous.length ? Math.min(...previous.map(s => hueDistance(artistHue(p.rgb), artistHue(s.rgb)))) : 180;
    const score = hueDistance(artistHue(p.rgb), target) + 12 * (1 - saturationScore(p.rgb))
      + 45 * Math.max(0, 1 - gap / 35) + 8 * (1 - Math.sqrt(p.count / maxCount));
    if (score < bestScore || (score === bestScore && p.count > best.count)) { best = p; bestScore = score; }
  }
  return best;
}

// A separable, alpha-aware blur groups brushwork without bleeding transparent RGB.
function squint(data, width, height) {
  const horizontal = new Float64Array(data.length);
  const output = new Uint8ClampedArray(data.length);
  const weights = [1, 4, 6, 4, 1];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    for (let d = -2; d <= 2; d++) {
      const source = (y * width + Math.max(0, Math.min(width - 1, x + d))) * 4;
      const weight = weights[d + 2] / 16;
      const alpha = data[source + 3] >= 128 ? data[source + 3] / 255 : 0;
      for (let c = 0; c < 3; c++) horizontal[offset + c] += data[source + c] * alpha * weight;
      horizontal[offset + 3] += alpha * weight;
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const sum = [0, 0, 0, 0];
    for (let d = -2; d <= 2; d++) {
      const source = (Math.max(0, Math.min(height - 1, y + d)) * width + x) * 4;
      for (let c = 0; c < 4; c++) sum[c] += horizontal[source + c] * weights[d + 2] / 16;
    }
    if (data[offset + 3] < 128 || !sum[3]) continue;
    for (let c = 0; c < 3; c++) output[offset + c] = sum[c] / sum[3];
    output[offset + 3] = data[offset + 3];
  }
  return output;
}

function collectPoints(data, width, height, spatial = false) {
  const bins = new Map();
  const keyAt = i => (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = keyAt(i);
    if (!bins.has(key)) bins.set(key, { key, rgb: [0, 0, 0], count: 0, support: 0 });
    const bin = bins.get(key);
    bin.count++;
    for (let c = 0; c < 3; c++) bin.rgb[c] += data[i + c];
    if (spatial) {
      const x = i / 4 % width, y = Math.floor(i / 4 / width);
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const j = ((y + dy) * width + x + dx) * 4;
        if (data[j + 3] >= 128 && Math.max(...[0, 1, 2].map(c => Math.abs(data[i + c] - data[j + c]))) <= 32) neighbors++;
      }
      if (neighbors >= 2) bin.support++;
    }
  }
  return [...bins.values()].map(p => {
    p.rgb = p.rgb.map(v => v / p.count);
    p.lab = lab(...p.rgb);
    return p;
  }).sort((a, b) => b.count - a.count);
}

function spatialFamilies(data, width, height, points, count) {
  const broad = colorFamilies(collectPoints(squint(data, width, height), width, height), count);
  const centers = broad.map(g => g.center);
  const total = points.reduce((n, p) => n + p.count, 0);
  // Recover coherent vivid accents that the blur may have diluted.
  if (count === undefined) {
    const accents = points.filter(p => p.support >= 3 && p.count / total >= MIN_ACCENT_COVERAGE
      && saturationScore(p.rgb) >= .4).sort((a, b) => saturationScore(b.rgb) - saturationScore(a.rgb));
    for (const p of accents) {
      if (centers.length >= MAX_COLORS) break;
      if (centers.every(center => familyDistance(p.lab, center) >= DISTINCT_DISTANCE ** 2)) centers.push(p.lab);
    }
  }
  const buckets = centers.map(() => []);
  for (const p of points) {
    let nearest = 0;
    for (let i = 1; i < centers.length; i++) {
      if (familyDistance(p.lab, centers[i]) < familyDistance(p.lab, centers[nearest])) nearest = i;
    }
    buckets[nearest].push(p);
  }
  return buckets.filter(bucket => bucket.length).map(summarize).sort((a, b) => b.count - a.count);
}

function hueCandidates(points, spatial, lighter) {
  const clusters = [];
  const total = points.reduce((sum, p) => sum + p.count, 0);
  for (const p of points) {
    if (saturationScore(p.rgb) < .08 || (spatial && p.support < 3)) continue;
    const hue = artistHue(p.rgb);
    let cluster = clusters.find(group => hueDistance(group.hue, hue) < 30);
    if (!cluster) { cluster = { hue, points: [] }; clusters.push(cluster); }
    cluster.points.push(p);
  }
  return clusters.map(cluster => summarize(cluster.points))
    .filter(group => group.count / total >= MIN_ACCENT_COVERAGE)
    .map(group => representative(group, true, spatial, lighter));
}

export function extractPalette(data, width, height, mode = 'prominent', count) {
  const spatial = width >= 3 && height >= 3;
  const points = collectPoints(data, width, height, spatial);
  if (!points.length) throw new Error('This image has no visible pixels.');
  if (count !== undefined) count = Math.max(2, Math.min(MAX_COLORS, Math.round(count)));
  const groups = spatial ? spatialFamilies(data, width, height, points, count) : colorFamilies(points, count);
  const pointOrder = new Map(points.map((p, index) => [p.key, index]));
  const candidates = groups.map(group => representative(group, mode !== 'prominent', spatial, mode === 'saturated'))
    .sort((a, b) => b.count - a.count || pointOrder.get(a.key) - pointOrder.get(b.key));
  let selected = candidates;
  if (mode === 'saturated' || mode === 'complimentary') {
    const desiredCount = candidates.length;
    // Original-image hue groups can survive even when broad clustering merged them.
    for (const p of hueCandidates(points, spatial, mode === 'saturated')) {
      if (!candidates.some(c => c.key === p.key)
        && candidates.every(c => saturationScore(c.rgb) < .08 || hueDistance(artistHue(c.rgb), artistHue(p.rgb)) >= 30)) candidates.push(p);
    }
    selected = [];
    if (mode === 'complimentary') {
      // Keep complete pairs for multi-color paintings without duplicating swatches.
      const targetCount = count !== undefined ? desiredCount : desiredCount === 1 ? 1 : desiredCount - desiredCount % 2;
      while (selected.length < targetCount) {
        const anchor = saturatedPick(candidates, selected);
        selected.push(anchor);
        if (selected.length < targetCount) selected.push(complementaryPick(candidates, anchor, selected));
      }
    } else {
      while (selected.length < desiredCount) {
        selected.push(saturatedPick(candidates, selected, true));
      }
    }
  }
  const results = selected.map(p => ({ center: p.lab, key: p.key, count: p.count, error: Infinity }));
  const byBin = new Map(results.map(result => [result.key, result]));
  // Use an actual image pixel for both the swatch and its pin, not an invented average.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    const result = byBin.get(key);
    if (!result) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const color = lab(...rgb);
    const x = (i / 4) % width, y = Math.floor(i / 4 / width);
    const error = distance(color, result.center);
    // A tiny center bias gives flat-color regions a useful, visible marker location.
    const score = error + .00001 * ((x / width - .5) ** 2 + (y / height - .5) ** 2);
    if (score < result.error) Object.assign(result, { error: score, rgb, x: (x + .5) / width, y: (y + .5) / height });
  }
  if (mode === 'prominent') results.sort((a, b) => b.count - a.count);
  return results;
}
