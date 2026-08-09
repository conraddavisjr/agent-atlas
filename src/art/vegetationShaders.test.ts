import { describe, it, expect } from 'vitest'
import { ShaderChunk, ShaderLib } from 'three'

/**
 * The chunk-token test for the two vegetation shaders.
 *
 * This exists because of a specific, verified failure mode that produces no
 * error and no warning. `material.onBeforeCompile(parameters, renderer)` is
 * called at `three.module.js:18210`, and `resolveIncludes` does not run until
 * `WebGLProgram` is built on the following line. So the shader an
 * `onBeforeCompile` hook receives still has its `#include` directives
 * **unresolved**, and a patch that searches for the body of a chunk matches
 * nothing and silently does nothing at all. `Grass.tsx` and `Flowers.tsx` both
 * replace directives for that reason, and both guard on the directive being
 * present before they write anything.
 *
 * The guard degrades safely but it degrades *silently at runtime*, in a build
 * nobody may be watching the console of. This test is the loud half: if a three
 * upgrade renames, moves or inlines any of these statements, `npm test` fails
 * with the token that moved, rather than the grass field quietly vanishing from
 * a screenshot three commits later.
 *
 * It is a plain `.ts` test importing only three, so it runs under Node with no
 * WebGL context, no canvas and no react-three-fiber.
 */

/**
 * Every directive the vegetation patches replace.
 *
 * Duplicated from `Grass.tsx` and `Flowers.tsx` rather than imported, because
 * importing either would pull react-three-fiber and a whole React tree into a
 * test whose entire job is to read four strings out of three. The duplication is
 * the point of failure this guards, so it is listed with the file that owns it.
 */
const PATCHED = [
  { file: 'Grass.tsx', token: '#include <common>' },
  { file: 'Grass.tsx', token: '#include <begin_vertex>' },
  { file: 'Grass.tsx', token: '#include <beginnormal_vertex>' },
  { file: 'Grass.tsx', token: '#include <color_vertex>' },
  { file: 'Flowers.tsx', token: '#include <common>' },
  { file: 'Flowers.tsx', token: '#include <begin_vertex>' },
] as const

describe('vegetation shader patch points', () => {
  for (const { file, token } of PATCHED) {
    it(`${file} can still find "${token}" in the standard vertex shader`, () => {
      expect(ShaderLib.standard.vertexShader).toContain(token)
    })
  }

  it('still ships every chunk the vegetation patches substitute for', () => {
    // A directive that survives while its chunk does not would mean the patch
    // applies and then compiles against something that no longer exists.
    for (const name of ['common', 'begin_vertex', 'beginnormal_vertex', 'color_vertex']) {
      expect(ShaderChunk).toHaveProperty(name)
      expect(typeof ShaderChunk[name as keyof typeof ShaderChunk]).toBe('string')
    }
  })

  it('still declares transformed inside begin_vertex rather than before it', () => {
    /*
      `Grass.tsx` replaces `#include <begin_vertex>` with its own declaration of
      `transformed`, which is only correct while three declares that variable
      inside the chunk. If it ever moves the declaration out, the grass patch
      redeclares an existing variable and the whole field fails to compile,
      which is the failure mode that reports 178,988 instances and `visible:
      true` while drawing nothing.
    */
    expect(ShaderChunk.begin_vertex).toContain('vec3 transformed')
  })

  it('still writes vColor in color_vertex, which the grass tint multiplies', () => {
    /*
      And a reminder of why that patch is written as `vColor.rgb *= iColor`
      rather than `vColor *= iColor`: three declares this varying as a vec3 or a
      vec4 depending on build flags and it changed in 0.185. The vec4 branch
      turns the whole-varying form into "cannot convert from 3-component to
      4-component", which took the entire 1.43M-triangle grass field out of the
      render while it still reported every instance as visible.
    */
    expect(ShaderChunk.color_vertex).toContain('vColor')
  })
})
