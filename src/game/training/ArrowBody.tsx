import { GLOW, emissive, mattePlastic } from '@/art/materials'
import { palette } from '@/art/palette'

/**
 * The plunger arrow's geometry: shaft, rubber cup, flights.
 *
 * ## Its own file because it has three mounts
 *
 * Nocked on the string, in flight through the air, and stuck in a plank. Three
 * copies of this would drift, and the copy that drifted would be the one the
 * player watches most closely - a cup that is one size on the string and another
 * in the wood reads as the arrow changing on impact.
 *
 * A plunger rather than a point because the brief says so, and because a suction
 * cup is the one arrowhead that can be fired at a face in a children's game
 * without anybody flinching.
 *
 * ## Built along +Z
 *
 * `Object3D.lookAt` orients a plain object so its **+Z** faces the target - which
 * is the opposite of a camera, where lookAt points -Z. Every parent that aims
 * this thing uses `lookAt`, so the shaft runs along +Z with the cup at the far
 * end and the flights behind the origin.
 */
export function ArrowBody() {
  return (
    <>
      <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.44, 8]} />
        <meshPhysicalMaterial {...mattePlastic('#e8dcc4')} />
      </mesh>
      {/* The cup, opening forward. A cone with its wide end away from the shaft. */}
      <mesh position={[0, 0, 0.46]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.03, 0.07, 12, 1, true]} />
        <meshPhysicalMaterial {...mattePlastic(PLUNGER_RUBBER, { side: 2 })} />
      </mesh>
      {/*
        Flights: two quads CROSSED ALONG the shaft, which is the second version.

        The first was a single square at `rotation={[0, 0, 0]}`. A plane's own
        normal is +Z and the shaft runs along +Z, so that quad was perpendicular
        to the arrow - a flat card stuck across the nock. From the side, in third
        person, it read as a fletching and nobody looked twice. Down the shaft, in
        first person, it is a glowing square filling the corner of the screen, and
        it is the first thing you notice.

        Rotating each quad to CONTAIN the shaft axis is what fletching actually
        is. Two of them at right angles means one is always broadside no matter
        how the arrow rolls, and the pair read as vanes from any angle.

        `meshPhysicalMaterial`, because `emissive()` returns PHYSICAL material
        props. Spreading them onto a basic material throws inside three's
        `refreshUniformsCommon` on every frame and kills the render partway
        through - the scene keeps showing an older frame and nothing in the scene
        graph looks wrong. That mistake has been made twice in this feature, which
        is why `materialPresets.test.ts` now fails the build for it.
      */}
      {[
        [Math.PI / 2, 0, 0],
        [0, Math.PI / 2, 0],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[0, 0, 0.03]} rotation={[x, y, z]}>
          {/* Width across the shaft, height ALONG it - the rotations swap the axes. */}
          <planeGeometry args={[0.048, 0.085]} />
          <meshPhysicalMaterial {...emissive(palette.visor, GLOW.source)} side={2} />
        </mesh>
      ))}
    </>
  )
}

const PLUNGER_RUBBER = '#e0483c'
