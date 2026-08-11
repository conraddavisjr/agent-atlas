#!/usr/bin/env node
/**
 * Driver for the hub occlusion bake. `npm run bake:lightmap`.
 *
 * ## Why this file is a shim and the bake itself is TypeScript
 *
 * The bake has to build the SAME geometry the game draws, which means importing
 * `src/game/world/hubLayout.ts` and `src/art/geometry.ts`. Node 20 - which is what
 * this project runs, `node --version` says 20.20.2 - cannot import TypeScript, and
 * has no `--experimental-strip-types` (that arrived in 22.6). The project has no
 * `tsx` or `ts-node`, and adding one for a build tool is a dependency the repo does
 * not otherwise need.
 *
 * Vite 8 is already a dependency and exposes `runnerImport`, which evaluates a TS
 * module in this process with the project's own resolution rules. That is what this
 * file is for.
 *
 * **The alias is passed inline and `configFile` is false, and both are deliberate.**
 * `runnerImport` does NOT apply `vite.config.ts`'s `resolve.alias` to its SSR
 * environment - tried first, and `@/game/world/hubLayout` failed to resolve - so the
 * alias has to be given here. Reading the real config instead would also pull in the
 * React plugin and the manual-chunks callback, neither of which means anything in
 * Node.
 *
 * **Nothing in this file may import `three`.** Vite resolves three to its browser
 * build inside the runner, so a top-level `import { Vector3 } from 'three'` here
 * creates a SECOND three instance - it prints "Multiple instances of Three.js being
 * imported", and then `instanceof` checks across the boundary quietly fail. Every
 * three object stays on the far side of `runnerImport`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : fallback
}
const dryRun = args.includes('--dry')

const { module: bake } = await runnerImport(join(here, 'bakeHubLightmap.ts'), {
  root,
  configFile: false,
  resolve: { alias: { '@': join(root, 'src') } },
})

const size = flag('size', 0)
const tpm = flag('tpm', 0)
if ((size || tpm) && !dryRun) {
  process.stderr.write('--size and --tpm are sizing aids and only work with --dry.\n')
  process.exit(1)
}

const options = {
  rays: flag('rays', bake.DEFAULT_RAYS),
  maxDistance: flag('distance', bake.DEFAULT_MAX_DISTANCE),
  dryRun,
  atlas: size && tpm ? { size, texelsPerMetre: tpm, gutter: 2 } : undefined,
}

process.stdout.write(
  `baking hub occlusion: ${options.rays} rays, ${options.maxDistance} m reach` +
    `${dryRun ? ', DRY RUN (no trace, no output)' : ''}\n`,
)

let lastTick = 0
const result = bake.bakeHubLightmap({
  ...options,
  onProgress(fraction) {
    // Throttled to one line a second. A progress line per chart is 240 lines for a
    // 90-second job, which buries the report that follows it.
    const now = Date.now()
    if (now - lastTick < 1000 && fraction < 1) return
    lastTick = now
    process.stdout.write(`  ${(fraction * 100).toFixed(0)}%\n`)
  },
})

for (const line of result.report) process.stdout.write(`${line}\n`)

/*
  `--probe=mesh,part,face` prints one chart as ASCII. It is the only way this
  stream can verify the bake at all: it is not allowed to drive the browser, and a
  lightmap is valid-looking whatever is in it. Repeatable, so several charts can be
  compared side by side in one run.
*/
for (const arg of args.filter((a) => a.startsWith('--probe='))) {
  const [mesh, part, face] = arg.slice('--probe='.length).split(',').map(Number)
  process.stdout.write('\n')
  for (const line of bake.probeChart(result, mesh, part, face)) process.stdout.write(`${line}\n`)
}

if (dryRun) {
  process.stdout.write('dry run: nothing written\n')
  process.exit(0)
}

const outDir = join(root, 'src', 'art')
mkdirSync(outDir, { recursive: true })
const png = join(outDir, 'lightmapHub.png')
const json = join(outDir, 'lightmapHub.manifest.json')
writeFileSync(png, result.png)
writeFileSync(json, `${JSON.stringify(result.manifest, null, 2)}\n`)

process.stdout.write(`wrote      ${png}\n`)
process.stdout.write(`wrote      ${json}\n`)
process.stdout.write(`hash       ${result.manifest.hash}\n`)
process.exit(0)
