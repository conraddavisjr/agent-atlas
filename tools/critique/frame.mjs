// Value measurement on a captured frame, in the same convention as
// __dev.sample(): Rec.709 luma on the GAMMA-ENCODED sRGB bytes, 0-1.
//
// It reads raw RGB out of ImageMagick rather than asking ImageMagick for a
// number, because IM7's -fx/%[fx:] operate after its own colorspace handling
// and disagree with the eyedropper convention by about 0.18 of luma on these
// frames - which is more than a whole value band. Anything that measures the
// frame has to be checked against __dev.sample() before it is believed; see
// `verify` below.
//
//   node frame.mjs bands <png>                 band occupancy, %
//   node frame.mjs box <png> x y w h [...]     mean rgb/luma of each box
//   node frame.mjs col <png> x y0 y1           a vertical 1px luma profile
//   node frame.mjs row <png> y x0 x1           a horizontal 1px luma profile
//   node frame.mjs hf <png> x y w h            RMS deviation from local 5x5 mean, /255
//   node frame.mjs grid <png> cols rows        a coarse luma map

import { execFileSync } from 'node:child_process'

const [, , cmd, file, ...rest] = process.argv

function read(png) {
  const head = execFileSync('magick', [png, '-format', '%w %h', 'info:']).toString().trim().split(' ')
  const w = +head[0], h = +head[1]
  const buf = execFileSync('magick', [png, '-depth', '8', 'RGB:-'], { maxBuffer: 1 << 30 })
  if (buf.length !== w * h * 3) throw new Error(`expected ${w * h * 3} bytes, got ${buf.length}`)
  return { w, h, buf }
}

const lumaAt = ({ buf }, i) => (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255

function boxStats(img, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0, lo = 1, hi = 0
  for (let yy = y; yy < Math.min(y + h, img.h); yy++) {
    for (let xx = x; xx < Math.min(x + w, img.w); xx++) {
      const i = (yy * img.w + xx) * 3
      r += img.buf[i]; g += img.buf[i + 1]; b += img.buf[i + 2]
      const l = lumaAt(img, i)
      if (l < lo) lo = l
      if (l > hi) hi = l
      n++
    }
  }
  const mr = r / n, mg = g / n, mb = b / n
  return {
    rgb: [Math.round(mr), Math.round(mg), Math.round(mb)],
    luma: +((0.2126 * mr + 0.7152 * mg + 0.0722 * mb) / 255).toFixed(4),
    min: +lo.toFixed(4), max: +hi.toFixed(4),
    warmth: Math.round(mr - mb),
    n,
  }
}

const BANDS = [
  ['anchor', 0, 0.2], ['midground', 0.2, 0.38], ['gap-lo', 0.38, 0.56],
  ['gameplay', 0.56, 0.74], ['gap-hi', 0.74, 0.76], ['background', 0.76, 0.86],
  ['over', 0.86, 1.01],
]

if (cmd === 'bands') {
  const img = read(file)
  const counts = BANDS.map(() => 0)
  const deciles = new Array(20).fill(0)
  let sum = 0
  const n = img.w * img.h
  for (let i = 0; i < img.buf.length; i += 3) {
    const l = lumaAt(img, i)
    sum += l
    deciles[Math.min(19, Math.floor(l * 20))]++
    for (let b = 0; b < BANDS.length; b++) {
      if (l >= BANDS[b][1] && l < BANDS[b][2]) { counts[b]++; break }
    }
  }
  const pct = (c) => +(100 * c / n).toFixed(2)
  console.log(JSON.stringify({
    file, size: [img.w, img.h], mean: +(sum / n).toFixed(4),
    bands: Object.fromEntries(BANDS.map((b, i) => [b[0], pct(counts[i])])),
    below: {
      '0.10': pct(deciles.slice(0, 2).reduce((a, c) => a + c, 0)),
      '0.15': pct(deciles.slice(0, 3).reduce((a, c) => a + c, 0)),
      '0.20': pct(deciles.slice(0, 4).reduce((a, c) => a + c, 0)),
      '0.30': pct(deciles.slice(0, 6).reduce((a, c) => a + c, 0)),
      '0.40': pct(deciles.slice(0, 8).reduce((a, c) => a + c, 0)),
    },
    above: { '0.80': pct(deciles.slice(16).reduce((a, c) => a + c, 0)) },
    twentieths: deciles.map((c) => pct(c)),
  }))
} else if (cmd === 'box') {
  const img = read(file)
  const out = []
  for (let i = 0; i + 3 < rest.length + 1; i += 4) {
    const [x, y, w, h] = rest.slice(i, i + 4).map(Number)
    out.push({ box: [x, y, w, h], ...boxStats(img, x, y, w, h) })
  }
  console.log(JSON.stringify(out, null, 1))
} else if (cmd === 'col') {
  const img = read(file)
  const [x, y0, y1] = rest.map(Number)
  const out = []
  for (let y = y0; y <= y1; y++) out.push(+lumaAt(img, (y * img.w + x) * 3).toFixed(3))
  console.log(JSON.stringify({ x, y0, y1, luma: out }))
} else if (cmd === 'row') {
  const img = read(file)
  const [y, x0, x1] = rest.map(Number)
  const out = []
  for (let x = x0; x <= x1; x++) out.push(+lumaAt(img, (y * img.w + x) * 3).toFixed(3))
  console.log(JSON.stringify({ y, x0, x1, luma: out }))
} else if (cmd === 'hf') {
  // RMS deviation of each pixel from its own 5x5 local mean, in /255. Ignores
  // gradients, so it isolates high-frequency noise: round 2's metric for the
  // grass-shadow crackle.
  const img = read(file)
  const [x, y, w, h] = rest.map(Number)
  let acc = 0, n = 0
  for (let yy = y + 2; yy < y + h - 2; yy++) {
    for (let xx = x + 2; xx < x + w - 2; xx++) {
      let m = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        m += lumaAt(img, ((yy + dy) * img.w + xx + dx) * 3)
      }
      const d = lumaAt(img, (yy * img.w + xx) * 3) - m / 25
      acc += d * d; n++
    }
  }
  console.log(JSON.stringify({ box: [x, y, w, h], hf: +(255 * Math.sqrt(acc / n)).toFixed(2) }))
} else if (cmd === 'grid') {
  const img = read(file)
  const [cols, rows] = rest.map(Number)
  const cw = Math.floor(img.w / cols), ch = Math.floor(img.h / rows)
  const map = []
  for (let r = 0; r < rows; r++) {
    map.push(Array.from({ length: cols }, (_, c) => boxStats(img, c * cw, r * ch, cw, ch).luma.toFixed(2)).join(' '))
  }
  console.log(map.join('\n'))
} else if (cmd === 'where') {
  // WHERE the darks are, as numbers. A dark value's job depends on where it
  // sits: contiguous along the bottom it is the ground's mass, distributed
  // around the perimeter on verticals it is a cage. This is that distinction,
  // measurable.
  const img = read(file)
  const threshold = Number(rest[0])
  const rows = [0, 0, 0], cols = [0, 0, 0]
  let hits = 0
  const t3 = Math.floor(img.h / 3), c3 = Math.floor(img.w / 3)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (lumaAt(img, (y * img.w + x) * 3) >= threshold) continue
      hits++
      rows[Math.min(2, Math.floor(y / t3))]++
      cols[Math.min(2, Math.floor(x / c3))]++
    }
  }
  const share = (a) => a.map((c) => +(100 * c / Math.max(1, hits)).toFixed(1))
  console.log(JSON.stringify({
    threshold,
    pctOfFrame: +(100 * hits / (img.w * img.h)).toFixed(2),
    byRowThird: { top: share(rows)[0], middle: share(rows)[1], bottom: share(rows)[2] },
    byColThird: { left: share(cols)[0], centre: share(cols)[1], right: share(cols)[2] },
  }))
} else if (cmd === 'mask') {
  // Where the darks are, as a picture: pixels below the threshold in white,
  // everything else in black. Written through magick so the threshold is
  // applied in this file's luma convention rather than ImageMagick's.
  const img = read(file)
  const [threshold, out] = [Number(rest[0]), rest[1]]
  const mask = Buffer.alloc(img.w * img.h)
  let hits = 0
  for (let p = 0; p < mask.length; p++) {
    const on = lumaAt(img, p * 3) < threshold
    if (on) hits++
    mask[p] = on ? 255 : 0
  }
  execFileSync('magick', ['-size', `${img.w}x${img.h}`, '-depth', '8', 'GRAY:-', '-resize', '900x', out], { input: mask })
  console.log(JSON.stringify({ threshold, pct: +(100 * hits / mask.length).toFixed(2), out }))
} else {
  console.error('usage: bands|box|col|row|hf|grid|mask <png> ...')
  process.exit(1)
}
