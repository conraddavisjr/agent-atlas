/**
 * Minimal 8-bit greyscale PNG codec for the offline lightmap baker.
 *
 * This exists instead of a dependency because the baker needs exactly one
 * colour type (0, greyscale) at exactly one bit depth (8), and every PNG
 * library on npm brings a general-purpose chunk parser, a colour-space model
 * and a stream API along with it. `node:zlib` already does the only hard part.
 *
 * Both directions live here on purpose. An encoder with no decoder is an
 * encoder nobody can test: the only honest check that the bytes are a real PNG
 * is to read them back and compare, and a bake that writes a texture it cannot
 * itself read is a bake that fails in the browser instead of at the command
 * line. So `decodeGrayPng` is a real decoder - it implements all five filter
 * types and verifies every chunk CRC - rather than a mirror of the encoder's
 * single choice.
 */

import { deflateSync, inflateSync } from 'node:zlib'

/**
 * The 8-byte PNG signature. The trailing CRLF/LF pair is the historical
 * newline-mangling canary, and the 26 is DOS end-of-file so `type` on a PNG
 * stops early.
 */
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

/** Bytes per pixel at colour type 0, bit depth 8. Named because the filter code reads better with it. */
const BPP = 1

/*
  CRC32 lookup table, built on first use.

  Hand-rolled rather than `zlib.crc32` because that helper landed in Node 22
  and this project runs on Node 20, where reaching for it gives you
  `TypeError: zlib.crc32 is not a function` at bake time - after the geometry
  work is already done. Building 256 entries costs microseconds once.
*/
let crcTable: Int32Array | null = null

function crc32Table(): Int32Array {
  if (crcTable !== null) return crcTable
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let bit = 0; bit < 8; bit += 1) {
      // 0xedb88320 is the reversed CRC-32 polynomial, which is what PNG uses.
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    // `^` in JS yields a signed int32, so Int32Array stores these losslessly.
    table[n] = c
  }
  crcTable = table
  return table
}

/** CRC32 over `bytes[from, to)`, returned unsigned. */
function crc32(bytes: Uint8Array, from: number, to: number): number {
  const table = crc32Table()
  let c = 0xffffffff
  for (let i = from; i < to; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff
  bytes[at + 1] = (value >>> 16) & 0xff
  bytes[at + 2] = (value >>> 8) & 0xff
  bytes[at + 3] = value & 0xff
}

/**
 * Write one chunk at `at` and return the offset just past it.
 *
 * Layout is length (u32 BE, payload only), the four ASCII type bytes, the
 * payload, then a CRC32 (u32 BE) taken over type *and* payload. The CRC
 * covering the type but not the length is the part that is easy to get wrong
 * and that no viewer will explain to you - it just says "corrupt".
 */
function writeChunk(out: Uint8Array, at: number, type: string, data: Uint8Array): number {
  writeU32(out, at, data.length)
  for (let i = 0; i < 4; i += 1) out[at + 4 + i] = type.charCodeAt(i)
  out.set(data, at + 8)
  const end = at + 8 + data.length
  writeU32(out, end, crc32(out, at + 4, end))
  return end + 4
}

/**
 * Encode `gray` (row-major, row 0 first, `width * height` bytes) as an 8-bit
 * greyscale PNG.
 */
export function encodeGrayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(
      `png: encodeGrayPng needs positive integer dimensions, got ${width}x${height}`,
    )
  }
  if (gray.length !== width * height) {
    throw new Error(
      `png: encodeGrayPng got ${gray.length} bytes for a ${width}x${height} image, ` +
        `which needs exactly ${width * height}`,
    )
  }

  /*
    Every scanline is filtered with type 1 (Sub) rather than type 0 (None).

    A lightmap is a smooth gradient: neighbouring texels differ by one or two
    levels almost everywhere, and only at a shadow edge by more. Storing the
    raw values leaves deflate a stream of ~200 distinct symbols with no short
    repeats to match; storing left-neighbour differences collapses it to a
    handful of small values around zero, which is exactly the distribution
    Huffman coding is good at.

    Sub predicts each byte from the byte one to its left, with 0 standing in for
    the byte before the start of a row, and stores `(raw - left) & 0xff`.

    Measured, as deflate level 9 output over width * height:

      image                                None     Sub      Up    adaptive
      256x256 linear (x*7 + y*13) & 255    2.39%   1.19%   0.95%      1.75%
      256x256 smooth sinusoid             25.88%  12.26%  14.74%     15.23%
      512x512 AO-like, hard shadow edges  48.40%  33.92%  36.80%     36.37%

    Two things in that table are worth keeping. Sub roughly halves None on the
    cases that resemble real bake output, which is the whole justification for
    filtering at all. And per-row adaptive filtering - the libpng heuristic of
    trying all five and keeping the row with the smallest sum of absolute signed
    deviations - is *worse* than fixed Sub on every one of these images, which
    was not the expected result. It loses because switching filter type between
    rows changes the byte distribution from row to row, and that destroys the
    long cross-row LZ77 matches that a gradient otherwise hands deflate for
    free. So adaptive filtering was tried and dropped: it costs five times the
    filtering work, makes the decode path unreasonable from the encoder, and
    gives back three points.

    Up wins on the pure linear ramp only, because that image has literally
    identical vertical deltas; it loses on both realistic images. Not worth
    special-casing.
  */
  const stride = width + BPP
  const filtered = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const src = y * width
    const dst = y * stride
    filtered[dst] = 1
    filtered[dst + 1] = gray[src]
    for (let x = 1; x < width; x += 1) {
      filtered[dst + 1 + x] = (gray[src + x] - gray[src + x - 1]) & 0xff
    }
  }

  const idat = deflateSync(filtered, { level: 9 })

  const ihdr = new Uint8Array(13)
  writeU32(ihdr, 0, width)
  writeU32(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // colour type: greyscale
  ihdr[10] = 0 // compression: deflate, the only legal value
  ihdr[11] = 0 // filter method: the adaptive five, the only legal value
  ihdr[12] = 0 // interlace: none

  const total = SIGNATURE.length + (12 + ihdr.length) + (12 + idat.length) + 12
  const out = new Uint8Array(total)
  out.set(SIGNATURE, 0)
  let at = SIGNATURE.length
  at = writeChunk(out, at, 'IHDR', ihdr)
  at = writeChunk(out, at, 'IDAT', idat)
  at = writeChunk(out, at, 'IEND', new Uint8Array(0))
  if (at !== total) {
    // Unreachable unless the size arithmetic above drifts from writeChunk.
    throw new Error(`png: encodeGrayPng wrote ${at} bytes into a ${total}-byte buffer`)
  }
  return out
}

/**
 * Paeth predictor from the PNG spec: pick whichever of left, above and
 * above-left is closest to the plane they define.
 */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = p > a ? p - a : a - p
  const pb = p > b ? p - b : b - p
  const pc = p > c ? p - c : c - p
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Decode an 8-bit greyscale, non-interlaced PNG.
 *
 * Scope is deliberately narrow - colour type 0, bit depth 8 - because that is
 * what the baker writes and reads. What is *not* narrowed is filtering: all
 * five filter types are unfiltered here even though `encodeGrayPng` only ever
 * emits Sub, so this stays a decoder that can read someone else's greyscale
 * PNG rather than a function that only agrees with its own encoder.
 */
export function decodeGrayPng(bytes: Uint8Array): {
  width: number
  height: number
  gray: Uint8Array
} {
  if (bytes.length < SIGNATURE.length) {
    throw new Error(`png: decodeGrayPng got ${bytes.length} bytes, too short to be a PNG`)
  }
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error(
        `png: decodeGrayPng found a bad signature at byte ${i} ` +
          `(expected ${SIGNATURE[i]}, got ${bytes[i]})`,
      )
    }
  }

  let width = 0
  let height = 0
  let sawIhdr = false
  let sawIend = false
  const idatParts: Uint8Array[] = []
  let idatLength = 0

  let at = SIGNATURE.length
  while (at < bytes.length) {
    if (at + 8 > bytes.length) {
      throw new Error(`png: decodeGrayPng ran out of bytes inside a chunk header at ${at}`)
    }
    const length = readU32(bytes, at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    const dataStart = at + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) {
      throw new Error(
        `png: decodeGrayPng chunk ${type} at ${at} claims ${length} bytes but only ` +
          `${bytes.length - dataStart} remain`,
      )
    }

    // Every chunk is checked, not just the ones we consume. A CRC failure on an
    // ancillary chunk still means the file is damaged, and a bake that writes a
    // damaged texture should hear about it here.
    const stored = readU32(bytes, dataEnd)
    const actual = crc32(bytes, at + 4, dataEnd)
    if (stored !== actual) {
      throw new Error(
        `png: decodeGrayPng CRC mismatch in chunk ${type} at ${at} ` +
          `(stored 0x${stored.toString(16)}, computed 0x${actual.toString(16)})`,
      )
    }

    if (type === 'IHDR') {
      if (sawIhdr) throw new Error('png: decodeGrayPng found a second IHDR')
      if (at !== SIGNATURE.length) {
        throw new Error(`png: decodeGrayPng found IHDR at ${at}, but it must be the first chunk`)
      }
      if (length !== 13) {
        throw new Error(`png: decodeGrayPng got a ${length}-byte IHDR, which must be 13`)
      }
      width = readU32(bytes, dataStart)
      height = readU32(bytes, dataStart + 4)
      const bitDepth = bytes[dataStart + 8]
      const colourType = bytes[dataStart + 9]
      const compression = bytes[dataStart + 10]
      const filterMethod = bytes[dataStart + 11]
      const interlace = bytes[dataStart + 12]
      if (width <= 0 || height <= 0) {
        throw new Error(`png: decodeGrayPng got a ${width}x${height} image`)
      }
      if (colourType !== 0) {
        throw new Error(
          `png: decodeGrayPng only handles colour type 0 (greyscale), got ${colourType}`,
        )
      }
      if (bitDepth !== 8) {
        throw new Error(`png: decodeGrayPng only handles bit depth 8, got ${bitDepth}`)
      }
      if (compression !== 0) {
        throw new Error(`png: decodeGrayPng got compression method ${compression}, expected 0`)
      }
      if (filterMethod !== 0) {
        throw new Error(`png: decodeGrayPng got filter method ${filterMethod}, expected 0`)
      }
      if (interlace !== 0) {
        throw new Error('png: decodeGrayPng does not handle interlaced (Adam7) images')
      }
      sawIhdr = true
    } else if (type === 'IDAT') {
      if (!sawIhdr) throw new Error('png: decodeGrayPng found IDAT before IHDR')
      // The spec lets an encoder split the zlib stream across any number of
      // IDATs, so concatenate rather than assuming the one chunk we write.
      idatParts.push(bytes.subarray(dataStart, dataEnd))
      idatLength += length
    } else if (type === 'IEND') {
      sawIend = true
    }

    at = dataEnd + 4
    if (sawIend) break
  }

  if (!sawIhdr) throw new Error('png: decodeGrayPng found no IHDR chunk')
  if (!sawIend) throw new Error('png: decodeGrayPng found no IEND chunk')
  if (idatParts.length === 0) throw new Error('png: decodeGrayPng found no IDAT chunk')

  let compressed: Uint8Array
  if (idatParts.length === 1) {
    compressed = idatParts[0]
  } else {
    compressed = new Uint8Array(idatLength)
    let offset = 0
    for (const part of idatParts) {
      compressed.set(part, offset)
      offset += part.length
    }
  }

  const raw = inflateSync(compressed)
  const stride = width + BPP
  if (raw.length !== stride * height) {
    throw new Error(
      `png: decodeGrayPng inflated ${raw.length} bytes but a ${width}x${height} greyscale ` +
        `image needs ${stride * height} (one filter byte per row)`,
    )
  }

  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride]
    const src = y * stride + 1
    const dst = y * width
    // Row 0 behaves as though the row above it were all zero, which is why the
    // Up/Average/Paeth cases branch on `y` rather than reading out of bounds.
    const up = dst - width
    const hasUp = y > 0
    switch (filter) {
      case 0: {
        for (let x = 0; x < width; x += 1) gray[dst + x] = raw[src + x]
        break
      }
      case 1: {
        gray[dst] = raw[src]
        for (let x = 1; x < width; x += 1) {
          gray[dst + x] = (raw[src + x] + gray[dst + x - 1]) & 0xff
        }
        break
      }
      case 2: {
        for (let x = 0; x < width; x += 1) {
          gray[dst + x] = (raw[src + x] + (hasUp ? gray[up + x] : 0)) & 0xff
        }
        break
      }
      case 3: {
        for (let x = 0; x < width; x += 1) {
          const a = x > 0 ? gray[dst + x - 1] : 0
          const b = hasUp ? gray[up + x] : 0
          // Integer average, rounding down, per the spec - not (a + b) / 2.
          gray[dst + x] = (raw[src + x] + ((a + b) >> 1)) & 0xff
        }
        break
      }
      case 4: {
        for (let x = 0; x < width; x += 1) {
          const a = x > 0 ? gray[dst + x - 1] : 0
          const b = hasUp ? gray[up + x] : 0
          const c = hasUp && x > 0 ? gray[up + x - 1] : 0
          gray[dst + x] = (raw[src + x] + paethPredictor(a, b, c)) & 0xff
        }
        break
      }
      default: {
        throw new Error(`png: decodeGrayPng got filter type ${filter} on row ${y}, expected 0-4`)
      }
    }
  }

  return { width, height, gray }
}
