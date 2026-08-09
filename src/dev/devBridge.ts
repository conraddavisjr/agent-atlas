/**
 * The seam between the dev harness and the parts of the game it needs to drive.
 *
 * The harness has to put the player somewhere exact before a screenshot, and
 * only PlayerController can do that: the body is kinematic, so moving it means
 * `setNextKinematicTranslation` plus zeroing the velocity the controller is
 * integrating, and reaching into that from outside would leave the two
 * disagreeing about where the character is.
 *
 * So the controller registers a callback here instead. A module singleton
 * rather than context, matching `cameraFrame` and `irisHandle`, because it is
 * read outside React's tree and must survive the scene-keyed remounts.
 *
 * Everything here is development-only. Registration is guarded on
 * `import.meta.env.DEV`, so in a production build the callbacks stay null and
 * nothing calls them.
 */

export type TeleportFn = (x: number, y: number, z: number, facing?: number) => void

export const devBridge = {
  /** Registered by PlayerController while mounted. Null between scenes. */
  teleport: null as TeleportFn | null,
}
