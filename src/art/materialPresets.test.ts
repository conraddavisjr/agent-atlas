import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A source scan, which is an unusual thing to have and earns its place here.
 *
 * `materials.ts` exports two families of preset that look interchangeable at a
 * call site and are not:
 *
 *   - `emissive`, `plastic`, `mattePlastic`, `shell`, `steel`, `masonry` ...
 *     return MeshPhysicalMaterial props.
 *   - `glowStrip` returns MeshBasicMaterial props.
 *
 * Spreading a physical preset onto `<meshBasicMaterial>` type-checks - r3f's prop
 * types are permissive enough - and then throws inside three's own
 * `refreshUniformsCommon` on EVERY FRAME, at `WebGLRenderer.render`. The render
 * dies partway through, so the canvas keeps showing an older frame.
 *
 * That failure mode is why this test exists rather than a comment. Nothing in the
 * scene graph looks wrong: the object is there, its parent chain is visible, its
 * world position is correct. Three separate checks all say it is fine and the
 * picture is simply stale. The only place the truth is written down is the
 * console, and this project's own handoff opens with ten silent failures that each
 * produced a valid frame of the wrong thing.
 *
 * It has now been made twice in one feature - once on an instructor's eye lenses
 * and once on an arrow's flights - so it is worth a build failure.
 */

const PHYSICAL_ONLY = [
  'emissive',
  'emissiveRaw',
  'plastic',
  'mattePlastic',
  'rubber',
  'metal',
  'anodised',
  'stone',
  'ground',
  'gel',
  'shell',
  'vinyl',
  'flock',
  'chrome',
  'crystal',
  'visorPlate',
  'steel',
  'masonry',
]

/**
 * Strip comments before scanning.
 *
 * Found immediately: the first run of this test failed on `Instructor.tsx`, whose
 * doc comment QUOTES the broken line as the example of what not to do. A scan that
 * cannot tell code from prose punishes the file that documents the bug, which is
 * exactly backwards.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
}

describe('physical material presets are never spread onto a basic material', () => {
  it('finds no call site doing it', () => {
    const offenders: string[] = []
    const pattern = new RegExp(
      `<meshBasicMaterial[^>]*\\{\\.\\.\\.\\s*(${PHYSICAL_ONLY.join('|')})\\s*\\(`,
      's',
    )

    for (const file of sourceFiles('src')) {
      const source = stripComments(readFileSync(file, 'utf8'))
      /*
        Matched per JSX element rather than across the whole file, so a file that
        legitimately uses both a basic material and a physical preset elsewhere is
        not a false positive.
      */
      for (const element of source.split('<mesh').slice(1)) {
        const head = element.slice(0, element.indexOf('/>') + 2)
        if (pattern.test(`<mesh${head}`)) offenders.push(file)
      }
    }

    expect(offenders, 'spread a physical preset onto meshBasicMaterial').toEqual([])
  })

  it('recognises the mistake when it is present, so the scan cannot rot', () => {
    /*
      A scan that silently stopped matching would pass forever. This asserts the
      pattern against the exact shape of the bug as it was written, twice.
    */
    const pattern = new RegExp(
      `<meshBasicMaterial[^>]*\\{\\.\\.\\.\\s*(${PHYSICAL_ONLY.join('|')})\\s*\\(`,
      's',
    )
    expect(pattern.test('<meshBasicMaterial {...emissive(palette.visor, GLOW.source)} />')).toBe(true)
    // And that it leaves the correct preset alone.
    expect(pattern.test('<meshBasicMaterial {...glowStrip(palette.visor, GLOW.bloom)} />')).toBe(false)
  })
})
