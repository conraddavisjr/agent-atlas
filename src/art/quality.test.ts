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
    expect(QUALITY.low.aoSamples).toBe(0)
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
