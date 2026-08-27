import type { Material, Object3D } from 'three'

/**
 * Fading a whole form in and out, meshes and text together.
 *
 * ## Why this is a traversal and not a prop
 *
 * A form is three or four meshes, two instanced batches and up to eleven pieces
 * of troika text, authored across three components that know nothing about the
 * specimen. Threading an opacity prop down through all of that would mean every
 * station gaining a parameter it has no opinion about, and it would mean a React
 * render per frame for something that is a uniform write.
 *
 * So the specimen walks its own subtree instead. The cost is real but it is
 * bounded: the walk only runs while a form is actually mid-fade, which is 0.45 s
 * in every 2.5 s, and `applyPresence` returns early when the value it is being
 * asked for is the one already applied.
 *
 * ## The claim that made this file necessary, and the measurement that killed it
 *
 * Five files in this round used to carry a rule: nothing on this stage fades,
 * because troika's opacity lives in `fillOpacity` / `outlineOpacity` and "needs a
 * `sync()` to take effect, so a smooth fade is a text re-sync every frame for the
 * length of it". It was written once, in `Headline.tsx`, and cited everywhere
 * else. It was never measured, and it is wrong.
 *
 * From `troika-three-text` as installed:
 *
 *   - `SYNCABLE_PROPS` is an explicit list of eighteen names - `font`,
 *     `fontSize`, `letterSpacing`, `maxWidth`, `text`, `anchorX`, and so on.
 *   - Only those get a setter that raises `_needsSync`.
 *   - `fillOpacity`, `outlineOpacity` and `color` are **not** on it.
 *   - `uniforms.uTroikaFillOpacity.value` is assigned inside `_prepareForRender`,
 *     which runs on render regardless.
 *
 * Changing opacity is a uniform write. What genuinely does cost a re-layout is
 * changing `text`, which the caption does once per form change - about once every
 * 2.5 s, and hidden behind the change-over anyway.
 *
 * The rule was load-bearing: it is why the round lifts and brightens instead of
 * fading, and it is why an earlier draft of the specimen folded each form flat
 * rather than fading it. Folding would have squashed the labels inside the form
 * to six per cent of their height, which smears glyphs rather than hiding them.
 */

/** A troika `Text`, duck-typed. It carries no marker of its own on the object. */
type TroikaText = Object3D & { fillOpacity: number; outlineOpacity: number; sync: () => void }

function isTroikaText(o: Object3D): o is TroikaText {
  const t = o as Partial<TroikaText>
  return typeof t.fillOpacity === 'number' && typeof t.sync === 'function'
}

type Fadeable = Object3D & { material?: Material | Material[] }

/**
 * How opaque a material was authored to be, so a fade can restore it.
 *
 * Stashed on the material rather than in a map keyed by object, because the
 * material is what the value belongs to and a map would leak for the life of the
 * page every time a form remounted.
 */
const BASE_OPACITY = Symbol('specimen.baseOpacity')
type Tracked = Material & { [BASE_OPACITY]?: number }

function fadeMaterial(material: Material, presence: number, opaque: boolean) {
  const m = material as Tracked
  if (m[BASE_OPACITY] === undefined) m[BASE_OPACITY] = m.opacity
  const base = m[BASE_OPACITY]

  if (opaque) {
    /*
      Restored all the way, not left transparent at opacity 1.

      `transparent: true` costs whether or not anything is actually see-through:
      it disables depth write and moves the draw into the sorted pass, which for
      two interpenetrating instanced batches is exactly where sorting artefacts
      come from. The steady state is 82% of every beat and it should be identical
      to what shipped before the fade existed, so the flag comes back off.
    */
    if (m.transparent) {
      m.transparent = false
      m.needsUpdate = true
    }
    m.opacity = base
    m.depthWrite = true
    return
  }

  if (!m.transparent) {
    m.transparent = true
    m.needsUpdate = true
  }
  m.opacity = base * presence
  /*
    Depth write off while fading, and this is the half of it that is easy to
    miss. A half-transparent form that still writes depth punches a hole in
    everything drawn after it, so the floor grid and the horizon disappear behind
    a ghost for the length of the change-over.
  */
  m.depthWrite = false
}

/**
 * Set a form's presence, once, over its whole subtree.
 *
 * `presence` of 0 hides the group outright - a hidden subtree draws nothing,
 * sorts nothing and needs no transparent pass - and 1 restores the authored,
 * opaque state exactly.
 *
 * Returns the presence it applied, so the caller can skip the walk next frame
 * when nothing has changed.
 */
export function applyPresence(root: Object3D, presence: number): number {
  const p = Math.min(1, Math.max(0, presence))

  if (p <= 0) {
    root.visible = false
    return 0
  }
  root.visible = true

  const opaque = p >= 1
  root.traverse((child: Object3D) => {
    if (isTroikaText(child)) {
      /*
        Both, or the outline stays solid while the glyph fades and the text reads
        as a hollow stencil for the length of the change-over. Neither is on
        troika's syncable list, so this is two uniform writes.
      */
      child.fillOpacity = p
      child.outlineOpacity = p
      return
    }
    const material = (child as Fadeable).material
    if (!material) return
    if (Array.isArray(material)) material.forEach((m) => fadeMaterial(m, p, opaque))
    else fadeMaterial(material, p, opaque)
  })

  return p
}
