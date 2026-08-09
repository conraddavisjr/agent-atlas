import { describe, it, expect } from 'vitest'
import { QUALITY, selectTier, isQualityTier, type DeviceProfile } from './quality'

const profile = (over: Partial<DeviceProfile> = {}): DeviceProfile => ({
  renderer: 'NVIDIA GeForce RTX 3070',
  cores: 16,
  memoryGb: 8,
  ...over,
})

describe('tier selection', () => {
  it('gives a discrete GPU the top tier', () => {
    expect(selectTier(profile())).toBe('high')
  })

  it('never gives a software rasteriser anything but the lowest', () => {
    // No GPU behind the context, so nothing else about the machine matters.
    expect(selectTier(profile({ renderer: 'llvmpipe (LLVM 15.0.7)', cores: 32 }))).toBe('low')
    expect(selectTier(profile({ renderer: 'Google SwiftShader', cores: 32 }))).toBe('low')
  })

  it('treats Apple Silicon as fast despite being integrated', () => {
    // The case a plain integrated-substring check gets wrong, and the reason
    // that check is not the first thing the function does.
    expect(selectTier(profile({ renderer: 'Apple M2 Pro', cores: 10 }))).toBe('high')
  })

  it('caps Intel integrated graphics below the top tier', () => {
    expect(selectTier(profile({ renderer: 'Intel(R) UHD Graphics 620', cores: 8 }))).toBe(
      'medium',
    )
    expect(selectTier(profile({ renderer: 'Intel(R) HD Graphics 4000', cores: 2 }))).toBe('low')
  })

  it('caps mobile GPUs the same way', () => {
    expect(selectTier(profile({ renderer: 'Mali-G78', cores: 8 }))).toBe('medium')
    expect(selectTier(profile({ renderer: 'Adreno (TM) 640', cores: 4 }))).toBe('low')
  })

  it('guesses from core count when the renderer is masked', () => {
    // A privacy-masked desktop browser is more likely than a machine too old to
    // name itself, so this must not fall through to the worst case.
    expect(selectTier(profile({ renderer: '', cores: 12 }))).toBe('medium')
    expect(selectTier(profile({ renderer: 'unknown', cores: 2 }))).toBe('low')
  })

  it('steps a named but weak discrete card down one', () => {
    expect(selectTier(profile({ renderer: 'AMD Radeon HD 7000', memoryGb: 4 }))).toBe('medium')
    expect(selectTier(profile({ renderer: 'NVIDIA GeForce GT 710', cores: 4 }))).toBe('medium')
  })

  it('is case insensitive about the renderer string', () => {
    expect(selectTier(profile({ renderer: 'INTEL(R) IRIS(TM) PLUS', cores: 8 }))).toBe('medium')
  })
})

describe('tier settings', () => {
  it('orders every cost monotonically across the tiers', () => {
    // The property that makes the tiers meaningful: "higher" must never be
    // cheaper on any axis, or a player lowering their settings could get a
    // worse frame rate.
    const { low, medium, high } = QUALITY
    expect(low.grassBlades).toBeLessThan(medium.grassBlades)
    expect(medium.grassBlades).toBeLessThan(high.grassBlades)
    expect(low.flowers).toBeLessThan(medium.flowers)
    expect(medium.flowers).toBeLessThan(high.flowers)
    expect(low.shadowMapSize).toBeLessThan(medium.shadowMapSize)
    expect(medium.shadowMapSize).toBeLessThan(high.shadowMapSize)
    expect(low.propDensity).toBeLessThan(medium.propDensity)
    expect(medium.propDensity).toBeLessThan(high.propDensity)
    expect(low.maxDpr).toBeLessThanOrEqual(medium.maxDpr)
    expect(medium.maxDpr).toBeLessThanOrEqual(high.maxDpr)
  })

  it('keeps the most expensive setting to the top tier alone', () => {
    // Grass through the shadow pass a second time. Called out separately
    // because it is the one setting that can halve the frame rate by itself.
    expect(QUALITY.low.grassCastShadow).toBe(false)
    expect(QUALITY.medium.grassCastShadow).toBe(false)
    expect(QUALITY.high.grassCastShadow).toBe(true)
  })

  it('turns ambient occlusion off entirely at the bottom tier', () => {
    expect(QUALITY.low.ambientOcclusion).toBe(false)
    // The preset is still the cheap one rather than a placeholder, so forcing
    // AO on at this tier for a diagnostic does not also buy the expensive
    // settings.
    expect(QUALITY.low.aoQuality).toBe('low')
    expect(QUALITY.high.aoQuality).toBe('medium')
  })

  it('defines every setting on every tier', () => {
    /*
      The classic failure this catches is a field added to `high` and `medium`
      and forgotten at `low`, which then reads as `undefined` and behaves like
      whichever falsy or NaN value the consumer happens to produce. TypeScript
      catches a missing key at build time, but only while every tier is written
      out by hand in one file, and this table is exactly the kind of thing that
      later grows a spread or a generated default.

      Asserting key-set equality rather than a hard-coded list means the test
      keeps working as fields are added, and still fails the moment three tiers
      stop agreeing on what a tier is.
    */
    const low = Object.keys(QUALITY.low).sort()
    const medium = Object.keys(QUALITY.medium).sort()
    const high = Object.keys(QUALITY.high).sort()

    expect(medium).toEqual(low)
    expect(high).toEqual(low)

    for (const tier of ['low', 'medium', 'high'] as const) {
      for (const [key, value] of Object.entries(QUALITY[tier])) {
        expect(value, `${tier}.${key}`).not.toBeUndefined()
        if (typeof value === 'number') expect(Number.isFinite(value), `${tier}.${key}`).toBe(true)
      }
    }
  })

  it('carries every field the art overhaul specs gate against', () => {
    /*
      Named explicitly, and not derived from the type, because the point of the
      assertion is that this shape is the frozen interface several streams build
      against. Deleting or renaming one of these is a cross-stream break and
      should fail here rather than in someone else's half-finished feature.
    */
    const required = [
      'rimLight',
      'bounceFill',
      'contactShadow',
      'shadowRadius',
      'shadowBlurSamples',
      'hemisphereIntensity',
      'envResolution',
      'depthOfField',
      'chromaticAberration',
      'colourGrade',
      'bloomLevels',
      'aoQuality',
      'aoHalfRes',
      'surfaceMapSize',
      'sheenHero',
      'sheenWorld',
      'anisotropy',
      'transmission',
      'bevelSmoothness',
      'crystalGroves',
      'traceSegments',
      'nodeShells',
      'pylonCount',
      'pylonDetail',
      'visorDetail',
      'decals',
      'wrapDiffuse',
      'footIk',
      'particleBudget',
      'vfxDetail',
      'faceAnimation',
    ]

    for (const tier of ['low', 'medium', 'high'] as const) {
      for (const key of required) {
        expect(QUALITY[tier], `${tier}.${key}`).toHaveProperty(key)
      }
    }
  })

  it('leaves every unbuilt system inert at every tier', () => {
    /*
      These fields were added before the systems they configure. Until each
      system lands with its own acceptance evidence, none of them may be on at
      any tier, because a gate that defaults on turns "build the rim light" into
      "build the rim light and change the image at three tiers" in one commit,
      which is the one thing the rollout discipline forbids.

      A stream flipping one of these is expected to change this test in the same
      commit. That is the point: the change becomes deliberate and reviewable
      rather than a value nobody noticed.

      `rimLight`, `bounceFill` and `contactShadow` have left this list because
      the light rig and the blob now exist and landed with their acceptance
      shots, and `colourGrade` because the LUT does - it is on at every tier
      including `low`, where it replaces two grading effects with one texture
      fetch and is therefore cheaper than what it removes. `footIk` has left it
      too: the springs and the ground sample it drives are built, so leaving the
      flag false meant shipping code that never ran.
    */
    for (const tier of ['low', 'medium', 'high'] as const) {
      const q = QUALITY[tier]
      expect(q.depthOfField, tier).toBe(false)
      expect(q.chromaticAberration, tier).toBe(false)
      expect(q.surfaceMapSize, tier).toBe(0)
      expect(q.decals, tier).toBe(false)
      expect(q.wrapDiffuse, tier).toBe(false)
      expect(q.particleBudget, tier).toBe(0)
      expect(q.vfxDetail, tier).toBe('off')
      expect(q.faceAnimation, tier).toBe(false)
    }
  })

  it('keeps the bottom tier genuinely zero-cost on every new axis', () => {
    /*
      "Genuinely zero-cost" is stronger than "cheap": at `low`, nothing here may
      allocate a canvas, upload a texture, compile a shader variant, or add a
      draw call. Every one of these assertions is a thing that would do one of
      those.
    */
    const low = QUALITY.low
    expect(low.surfaceMapSize).toBe(0)
    expect(low.sheenHero).toBe(false)
    expect(low.sheenWorld).toBe(false)
    expect(low.anisotropy).toBe(false)
    expect(low.wrapDiffuse).toBe(false)
    expect(low.decals).toBe(false)
    expect(low.particleBudget).toBe(0)
    expect(low.depthOfField).toBe(false)
    expect(low.chromaticAberration).toBe(false)
    expect(low.ambientOcclusion).toBe(false)
    // Never above the tier above it, on any axis that costs frame time.
    expect(low.shadowRadius).toBeLessThanOrEqual(QUALITY.medium.shadowRadius)
    expect(low.shadowBlurSamples).toBeLessThanOrEqual(QUALITY.medium.shadowBlurSamples)
    expect(low.envResolution).toBeLessThanOrEqual(QUALITY.medium.envResolution)
    expect(low.bloomLevels).toBeLessThanOrEqual(QUALITY.medium.bloomLevels)
    expect(low.bevelSmoothness).toBeLessThanOrEqual(QUALITY.medium.bevelSmoothness)
  })

  it('gives every tier the two elements that most help a weak image', () => {
    /*
      The rim and the contact blob are on everywhere, including `low`, and that
      is a deliberate exception to "the bottom tier gets less of everything".
      `low` already gives up ambient occlusion, soft shadows and clouds; taking
      the rim as well would leave it looking like a different game rather than a
      cheaper one, and a 1024 shadow map cannot glue the robot to the floor on
      its own, which is exactly what the blob is for.

      The bounce fill is the one light `low` does not get, which keeps it at
      three directionals - the same count it had before the rig - and the
      hemisphere rises to absorb it.
    */
    for (const tier of ['low', 'medium', 'high'] as const) {
      expect(QUALITY[tier].rimLight, tier).toBe(true)
      expect(QUALITY[tier].contactShadow, tier).toBe(true)
    }
    expect(QUALITY.low.bounceFill).toBe(false)
    expect(QUALITY.medium.bounceFill).toBe(true)
    expect(QUALITY.high.bounceFill).toBe(true)
    expect(QUALITY.low.hemisphereIntensity).toBeGreaterThan(QUALITY.medium.hemisphereIntensity)
  })

  it('orders the new numeric dials monotonically as well', () => {
    const { low, medium, high } = QUALITY
    expect(medium.shadowRadius).toBeLessThanOrEqual(high.shadowRadius)
    expect(medium.shadowBlurSamples).toBeLessThanOrEqual(high.shadowBlurSamples)
    expect(medium.envResolution).toBeLessThanOrEqual(high.envResolution)
    expect(medium.bloomLevels).toBeLessThanOrEqual(high.bloomLevels)
    expect(medium.bevelSmoothness).toBeLessThanOrEqual(high.bevelSmoothness)
    expect(medium.particleBudget).toBeLessThanOrEqual(high.particleBudget)
    expect(medium.surfaceMapSize).toBeLessThanOrEqual(high.surfaceMapSize)
    expect(low.crystalGroves).toBeLessThanOrEqual(medium.crystalGroves)
    expect(medium.crystalGroves).toBeLessThanOrEqual(high.crystalGroves)
    expect(low.traceSegments).toBeLessThanOrEqual(medium.traceSegments)
    expect(medium.traceSegments).toBeLessThanOrEqual(high.traceSegments)
    expect(low.pylonCount).toBeLessThanOrEqual(medium.pylonCount)
    expect(medium.pylonCount).toBeLessThanOrEqual(high.pylonCount)
    // The hemisphere runs the other way: it is raised at `low` to absorb the
    // bounce fill that tier does not get, so the only invariant is the cap.
    expect(low.hemisphereIntensity).toBeLessThanOrEqual(0.6)
    expect(medium.hemisphereIntensity).toBeLessThanOrEqual(0.6)
    expect(high.hemisphereIntensity).toBeLessThanOrEqual(0.6)
  })
})

describe('isQualityTier', () => {
  it('accepts only the three tiers', () => {
    expect(isQualityTier('high')).toBe(true)
    expect(isQualityTier('ultra')).toBe(false)
    expect(isQualityTier(null)).toBe(false)
    expect(isQualityTier(undefined)).toBe(false)
  })
})
