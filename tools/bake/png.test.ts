import { describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'

import { decodeGrayPng, encodeGrayPng } from './png'

/** The gradient used for the main round trip. Deterministic, no PRNG needed. */
function gradient(width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gray[y * width + x] = (x * 7 + y * 13) & 0xff
    }
  }
  return gray
}

/**
 * A smooth two-dimensional sinusoid, which is what a real lightmap looks like
 * away from shadow edges: no discontinuities, small neighbour deltas.
 */
function smoothGradient(width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = 128 + 100 * Math.sin(x / 40) * Math.cos(y / 50)
      gray[y * width + x] = Math.max(0, Math.min(255, Math.round(v)))
    }
  }
  return gray
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

/**
 * Walk the chunk list independently of the codec, so the structural assertions
 * below are not just the decoder agreeing with the encoder.
 */
function chunks(bytes: Uint8Array): { type: string; start: number; dataStart: number; length: number }[] {
  const found: { type: string; start: number; dataStart: number; length: number }[] = []
  let at = 8
  while (at < bytes.length) {
    const length = readU32(bytes, at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    found.push({ type, start: at, dataStart: at + 8, length })
    at += 12 + length
  }
  return found
}

/** Independent CRC32, written the slow obvious way so it cannot share a bug with png.ts. */
function slowCrc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i += 1) {
    c ^= bytes[i]
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

describe('encodeGrayPng / decodeGrayPng', () => {
  it('round trips a 37x23 gradient byte for byte', () => {
    // Deliberately not a power of two and not square: a width/height mix-up or a
    // stride that forgets the filter byte both survive a square image.
    const gray = gradient(37, 23)
    const decoded = decodeGrayPng(encodeGrayPng(37, 23, gray))
    expect(decoded.width).toBe(37)
    expect(decoded.height).toBe(23)
    expect(Array.from(decoded.gray)).toEqual(Array.from(gray))
  })

  it('round trips a 1x1 image', () => {
    // The degenerate case for filter Sub: no left neighbour anywhere.
    const decoded = decodeGrayPng(encodeGrayPng(1, 1, Uint8Array.of(200)))
    expect(decoded.width).toBe(1)
    expect(decoded.height).toBe(1)
    expect(Array.from(decoded.gray)).toEqual([200])
  })

  it('round trips a constant-value image', () => {
    // Every Sub delta is zero except the first byte of each row, which is the
    // case where an off-by-one in the unfilter loop shows up as a whole image of
    // the wrong single value rather than as noise.
    const gray = new Uint8Array(16 * 9).fill(137)
    const decoded = decodeGrayPng(encodeGrayPng(16, 9, gray))
    expect(Array.from(decoded.gray)).toEqual(Array.from(gray))
  })

  it('round trips the full 0-255 range including the wrap at both ends', () => {
    // Sub stores (raw - left) & 0xff, so a run from 255 to 0 and back is where a
    // missing mask, or an unfilter that adds without masking, breaks.
    const gray = new Uint8Array(256 * 2)
    for (let x = 0; x < 256; x += 1) {
      gray[x] = x
      gray[256 + x] = 255 - x
    }
    const decoded = decodeGrayPng(encodeGrayPng(256, 2, gray))
    expect(Array.from(decoded.gray)).toEqual(Array.from(gray))
  })

  it('starts with the PNG signature', () => {
    const png = encodeGrayPng(4, 4, new Uint8Array(16))
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  it('writes an IHDR describing an 8-bit greyscale image', () => {
    const png = encodeGrayPng(37, 23, gradient(37, 23))
    const ihdr = chunks(png)[0]
    expect(ihdr.type).toBe('IHDR')
    expect(ihdr.length).toBe(13)
    expect(readU32(png, ihdr.dataStart)).toBe(37)
    expect(readU32(png, ihdr.dataStart + 4)).toBe(23)
    expect(png[ihdr.dataStart + 8]).toBe(8) // bit depth
    expect(png[ihdr.dataStart + 9]).toBe(0) // colour type: greyscale
    expect(png[ihdr.dataStart + 10]).toBe(0) // compression
    expect(png[ihdr.dataStart + 11]).toBe(0) // filter method
    expect(png[ihdr.dataStart + 12]).toBe(0) // interlace
  })

  it('emits IHDR, IDAT and IEND in that order and nothing else', () => {
    const png = encodeGrayPng(8, 8, gradient(8, 8))
    expect(chunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('gives every chunk a CRC that verifies against an independent CRC32', () => {
    const png = encodeGrayPng(37, 23, gradient(37, 23))
    const list = chunks(png)
    expect(list.length).toBe(3)
    for (const chunk of list) {
      const dataEnd = chunk.dataStart + chunk.length
      // CRC covers the type bytes and the payload, but not the length field.
      expect(readU32(png, dataEnd)).toBe(slowCrc32(png, chunk.start + 4, dataEnd))
    }
  })

  it('uses filter type 1 (Sub) on every scanline', () => {
    // The compression claim below only holds because of this, so assert the
    // encoder really is doing it rather than trusting the ratio alone.
    const width = 37
    const height = 23
    const png = encodeGrayPng(width, height, gradient(width, height))
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    expect(idat).toBeDefined()
    const raw = inflateSync(png.subarray(idat!.dataStart, idat!.dataStart + idat!.length))
    expect(raw.length).toBe((width + 1) * height)
    for (let y = 0; y < height; y += 1) {
      expect(raw[y * (width + 1)]).toBe(1)
    }
  })

  it('compresses a smooth 256x256 gradient to under 25% of the raw bytes', () => {
    /*
      This is the assertion that justifies filter Sub over filter None, so it is
      stated as a budget rather than left implied.

      Measured with deflate level 9, as a fraction of width * height:
        filter None       25.88%
        filter Sub        12.26%   <- what the encoder does
        filter Up         14.74%
        per-row adaptive  15.23%

      Note how little headroom None has against the 25% budget: it passes this
      threshold almost by accident on this image and fails outright on a real AO
      bake with hard shadow edges (48.40% None versus 33.92% Sub at 512x512).
      The check is on the IDAT payload, not on the whole file, because the ~57
      bytes of signature and chunk framing would otherwise flatter a small image
      and distort a large one differently.
    */
    const width = 256
    const height = 256
    const png = encodeGrayPng(width, height, smoothGradient(width, height))
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    expect(idat).toBeDefined()
    const ratio = idat!.length / (width * height)
    expect(ratio).toBeLessThan(0.25)
    // Guard the other direction too: if this ever drops near zero, the image
    // generator has gone constant and the test has stopped meaning anything.
    expect(ratio).toBeGreaterThan(0.01)
  })

  it('throws when a byte of the IDAT payload is corrupted', () => {
    const png = encodeGrayPng(37, 23, gradient(37, 23))
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    expect(idat).toBeDefined()
    const damaged = png.slice()
    // Flip bits in the middle of the compressed payload. A single-bit change is
    // enough - that is the point of a CRC.
    damaged[idat!.dataStart + (idat!.length >> 1)] ^= 0xff
    expect(() => decodeGrayPng(damaged)).toThrow(/CRC mismatch in chunk IDAT/)
  })

  it('throws when a byte of the IHDR payload is corrupted', () => {
    const png = encodeGrayPng(37, 23, gradient(37, 23))
    const damaged = png.slice()
    damaged[8 + 8 + 3] ^= 0x01 // low byte of the width
    expect(() => decodeGrayPng(damaged)).toThrow(/CRC mismatch in chunk IHDR/)
  })

  it('throws on a bad signature', () => {
    const png = encodeGrayPng(4, 4, new Uint8Array(16))
    const damaged = png.slice()
    damaged[1] = 0x50 + 1
    expect(() => decodeGrayPng(damaged)).toThrow(/bad signature at byte 1/)
    expect(() => decodeGrayPng(new Uint8Array(4))).toThrow(/too short to be a PNG/)
  })

  it('throws on a length mismatch between the dimensions and the data', () => {
    expect(() => encodeGrayPng(4, 4, new Uint8Array(15))).toThrow(
      /got 15 bytes for a 4x4 image, which needs exactly 16/,
    )
    expect(() => encodeGrayPng(4, 4, new Uint8Array(17))).toThrow(/needs exactly 16/)
  })

  it('throws on non-integer, zero or negative dimensions', () => {
    const gray = new Uint8Array(16)
    expect(() => encodeGrayPng(4.5, 4, gray)).toThrow(/positive integer dimensions/)
    expect(() => encodeGrayPng(4, 4.5, gray)).toThrow(/positive integer dimensions/)
    expect(() => encodeGrayPng(0, 4, gray)).toThrow(/positive integer dimensions/)
    expect(() => encodeGrayPng(4, -4, gray)).toThrow(/positive integer dimensions/)
    expect(() => encodeGrayPng(Number.NaN, 4, gray)).toThrow(/positive integer dimensions/)
  })
})

/*
  The remaining tests build PNGs by hand rather than through encodeGrayPng, which
  is the only way to exercise the decoder's rejection paths and the four filter
  types the encoder never emits. Without these, decodeGrayPng would be tested
  only against its own encoder and the claim that it is a real decoder would be
  unsupported.
*/

function crcInto(out: Uint8Array, at: number, typeAndDataStart: number, typeAndDataEnd: number): void {
  const crc = slowCrc32(out, typeAndDataStart, typeAndDataEnd)
  out[at] = (crc >>> 24) & 0xff
  out[at + 1] = (crc >>> 16) & 0xff
  out[at + 2] = (crc >>> 8) & 0xff
  out[at + 3] = crc & 0xff
}

function buildPng(parts: { type: string; data: Uint8Array }[]): Uint8Array {
  let total = 8
  for (const part of parts) total += 12 + part.data.length
  const out = new Uint8Array(total)
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  let at = 8
  for (const { type, data } of parts) {
    out[at] = (data.length >>> 24) & 0xff
    out[at + 1] = (data.length >>> 16) & 0xff
    out[at + 2] = (data.length >>> 8) & 0xff
    out[at + 3] = data.length & 0xff
    for (let i = 0; i < 4; i += 1) out[at + 4 + i] = type.charCodeAt(i)
    out.set(data, at + 8)
    const end = at + 8 + data.length
    crcInto(out, end, at + 4, end)
    at = end + 4
  }
  return out
}

function ihdrData(
  width: number,
  height: number,
  bitDepth = 8,
  colourType = 0,
  interlace = 0,
  compression = 0,
  filterMethod = 0,
): Uint8Array {
  const data = new Uint8Array(13)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  data[8] = bitDepth
  data[9] = colourType
  data[10] = compression
  data[11] = filterMethod
  data[12] = interlace
  return data
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Filter `gray` with a caller-chosen filter type per row, then deflate it. */
function handFilter(
  width: number,
  height: number,
  gray: Uint8Array,
  filterForRow: (y: number) => number,
): Uint8Array {
  const stride = width + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = filterForRow(y)
    raw[y * stride] = filter
    for (let x = 0; x < width; x += 1) {
      const value = gray[y * width + x]
      const a = x > 0 ? gray[y * width + x - 1] : 0
      const b = y > 0 ? gray[(y - 1) * width + x] : 0
      const c = y > 0 && x > 0 ? gray[(y - 1) * width + x - 1] : 0
      let stored: number
      switch (filter) {
        case 0:
          stored = value
          break
        case 1:
          stored = value - a
          break
        case 2:
          stored = value - b
          break
        case 3:
          stored = value - ((a + b) >> 1)
          break
        case 4:
          stored = value - paeth(a, b, c)
          break
        default:
          throw new Error(`test: no such filter ${filter}`)
      }
      raw[y * stride + 1 + x] = stored & 0xff
    }
  }
  return deflateSync(raw, { level: 9 })
}

describe('decodeGrayPng on files it did not write', () => {
  const width = 19
  const height = 11
  const gray = gradient(width, height)

  for (const filter of [0, 1, 2, 3, 4]) {
    it(`unfilters filter type ${filter}`, () => {
      const png = buildPng([
        { type: 'IHDR', data: ihdrData(width, height) },
        { type: 'IDAT', data: handFilter(width, height, gray, () => filter) },
        { type: 'IEND', data: new Uint8Array(0) },
      ])
      expect(Array.from(decodeGrayPng(png).gray)).toEqual(Array.from(gray))
    })
  }

  it('unfilters a file that changes filter type every row', () => {
    // A conforming encoder may pick per row. This is the case a decoder written
    // as a mirror of its own encoder gets wrong.
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IDAT', data: handFilter(width, height, gray, (y) => y % 5) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(Array.from(decodeGrayPng(png).gray)).toEqual(Array.from(gray))
  })

  it('reassembles a zlib stream split across several IDAT chunks', () => {
    const full = handFilter(width, height, gray, () => 1)
    const cut = Math.max(1, full.length >> 1)
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IDAT', data: full.subarray(0, cut) },
      { type: 'IDAT', data: full.subarray(cut) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(Array.from(decodeGrayPng(png).gray)).toEqual(Array.from(gray))
  })

  it('skips ancillary chunks it does not understand', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'gAMA', data: Uint8Array.of(0, 1, 134, 160) },
      { type: 'IDAT', data: handFilter(width, height, gray, () => 1) },
      { type: 'tEXt', data: Uint8Array.of(65, 0, 66) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(Array.from(decodeGrayPng(png).gray)).toEqual(Array.from(gray))
  })

  it('throws on an unsupported colour type', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height, 8, 2) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(png)).toThrow(/only handles colour type 0 \(greyscale\), got 2/)
  })

  it('throws on an unsupported bit depth', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height, 16, 0) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(png)).toThrow(/only handles bit depth 8, got 16/)
  })

  it('throws on an interlaced image', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height, 8, 0, 1) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(png)).toThrow(/does not handle interlaced/)
  })

  it('throws on an unknown compression or filter method', () => {
    const badCompression = buildPng([
      { type: 'IHDR', data: ihdrData(width, height, 8, 0, 0, 1) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(badCompression)).toThrow(/compression method 1, expected 0/)
    const badFilter = buildPng([
      { type: 'IHDR', data: ihdrData(width, height, 8, 0, 0, 0, 1) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(badFilter)).toThrow(/filter method 1, expected 0/)
  })

  it('throws when IHDR is missing or is not the first chunk', () => {
    const noIhdr = buildPng([
      { type: 'gAMA', data: Uint8Array.of(0, 1, 134, 160) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(noIhdr)).toThrow(/found no IHDR chunk/)
    const lateIhdr = buildPng([
      { type: 'gAMA', data: Uint8Array.of(0, 1, 134, 160) },
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(lateIhdr)).toThrow(/must be the first chunk/)
  })

  it('throws on a missing IDAT and on a missing IEND', () => {
    const noIdat = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(noIdat)).toThrow(/found no IDAT chunk/)
    const noIend = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IDAT', data: handFilter(width, height, gray, () => 1) },
    ])
    expect(() => decodeGrayPng(noIend)).toThrow(/found no IEND chunk/)
  })

  it('throws on an unknown filter type byte', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      // Filter 5 does not exist. Hand-build the raw stream so it survives to
      // the unfilter loop instead of being rejected earlier.
      {
        type: 'IDAT',
        data: (() => {
          const raw = new Uint8Array((width + 1) * height)
          for (let y = 0; y < height; y += 1) raw[y * (width + 1)] = 5
          return deflateSync(raw, { level: 9 })
        })(),
      },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(png)).toThrow(/filter type 5 on row 0, expected 0-4/)
  })

  it('throws when the inflated data is the wrong size for the dimensions', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IDAT', data: deflateSync(new Uint8Array((width + 1) * height - 3), { level: 9 }) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    expect(() => decodeGrayPng(png)).toThrow(/inflated \d+ bytes but a 19x11 greyscale image needs/)
  })

  it('throws when a chunk claims more bytes than the file holds', () => {
    const png = buildPng([
      { type: 'IHDR', data: ihdrData(width, height) },
      { type: 'IEND', data: new Uint8Array(0) },
    ])
    const damaged = png.slice()
    damaged[8 + 1] = 0xff // inflate IHDR's declared length
    expect(() => decodeGrayPng(damaged)).toThrow(/claims \d+ bytes but only \d+ remain/)
  })
})
