import { Suspense } from 'react'
import { Text } from '@react-three/drei'

/**
 * One piece of text on the diorama, with the stage's conventions applied once.
 *
 * ## Why every label goes through here
 *
 * Three of them, in three different files, would be three chances to get the half
 * turn wrong. `Headline.tsx` records what that costs: "troika's text faces +Z in
 * its own space, and every camera in this round sits at negative Z looking toward
 * positive Z - so an unrotated headline standing at the back of the stage shows
 * the player its back… It rendered as a clean, well-kerned, perfectly reversed
 * `WHAT IS AI?`". That inversion has now caught this feature out five times.
 *
 * It also carries the outline. `Headline.tsx` again: "three different outlines on
 * three pieces of text is how a world stops looking like one world" - same
 * `#0b1020`, same ratio to the size.
 *
 * ## The Suspense boundary is not decoration
 *
 * drei's `<Text>` suspends on a font fetched from a CDN at runtime, and `App.tsx`
 * puts the scene and `SceneReady` inside ONE boundary - so an unguarded `<Text>`
 * puts a network request on the critical path of the iris. Per label, so a stall
 * costs one word rather than the stage.
 *
 * Nothing here is emissive. `00-art-bible.md` reserves bloom for ally blue and
 * reward gold, and a glowing caption would read as something the player had won.
 */
export function StationLabel({
  text,
  size,
  colour,
  maxWidth,
  letterSpacing,
}: {
  text: string
  size: number
  colour: string
  maxWidth?: number
  letterSpacing?: number
}) {
  return (
    <Suspense fallback={null}>
      <Text
        rotation={[0, Math.PI, 0]}
        fontSize={size}
        color={colour}
        anchorX="center"
        anchorY="middle"
        maxWidth={maxWidth}
        letterSpacing={letterSpacing}
        textAlign="center"
        /* The house ratio, about a twentieth of the size. */
        outlineWidth={size * 0.05}
        outlineColor="#0b1020"
      >
        {text}
      </Text>
    </Suspense>
  )
}
