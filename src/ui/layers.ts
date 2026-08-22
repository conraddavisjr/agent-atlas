/**
 * The z-index scale for everything drawn over the canvas.
 *
 * There was not one. `HUD` used a literal 10, `AdminPanel` a literal 20 and the
 * iris a literal 50, each written where it was needed and none of them aware of
 * the others - which works exactly until two surfaces are added in the same week
 * and one of them picks 20 again.
 *
 * The order encodes an argument rather than a preference. The HUD is beneath
 * everything because it is passive. A scripted round's chrome sits above it
 * because while a round has the player the HUD's own prompts are stale. The admin
 * panel is above that because it is a developer tool that must be reachable when
 * the thing it is debugging is broken. The iris is above everything, because a
 * transition that something else could draw over is not covering the screen.
 */
export const LAYER = {
  hud: 10,
  overlay: 20,
  admin: 30,
  iris: 50,
} as const
