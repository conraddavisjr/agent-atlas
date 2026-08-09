# Agent Atlas

A browser-based course that teaches AI from zero, delivered as a walkable 3D world rather than a page of text.

Milestone 1 builds the world and its ergonomics.
There is deliberately no course content yet.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # progression rules and movement feel
npm run lint
npm run build    # static output in dist/, deployable to any static host
```

There is no backend and no accounts.
All progress lives in browser local storage under `agent-atlas-progress`.
Saves written under the old `ai-academy-progress` key are copied across once on first load.

## Controls

| Input | Action |
| --- | --- |
| W/S or up/down arrows | Drive forward and back, along the way the robot is facing |
| A/D or left/right arrows | Turn on the spot, continuously and in either direction |
| Space | Jump, with variable height |
| Mouse drag | Orbit the camera |
| E or Enter | Interact with the totem you are standing at |
| Gamepad | Left stick drives and turns, A jumps, X interacts, right stick orbits |

Movement is tank-style rather than camera-relative: the robot drives along its own facing, and the camera has no say in which way that is.
Turning and driving are independent axes, so holding forward and a turn together gives full speed *and* full turn rate, and the robot arcs at a radius of `maxSpeed / turnRate`.
Neither input taxes the other, which is the property `inputAxes.ts` exists to protect.

The camera swings back behind the direction you are travelling on its own, and it arrives rather than trailing.
Dragging always wins while you are dragging, and auto-alignment resumes the moment you move again, with no cooldown in between.

Graphics quality is guessed from your GPU on first load and can be changed in the top right, or forced with `?quality=low|medium|high`.

Falling off the island kills you.
Dying and arriving through a portal are the same event: the screen closes to a circle centred on the robot, and reopens as it drops back into the world.

## Where things are

- `src/game/player/tuning.ts` is the file to open when adjusting how the game feels.
  Every movement, jump, camera, and transition constant lives there so the play-adjust-play loop stays fast.
- `src/game/player/movement.ts` holds the feel logic as pure functions, unit tested in `movement.test.ts`.
  Coyote time, jump buffering, and variable jump height are verified there rather than by eye.
- `src/art/palette.ts` and `src/art/materials.ts` define the toy-plastic look.
  Lighting is per scene in `src/art/Lighting.tsx`.
- `src/game/scenes/registry.ts` maps scene ids to lazily loaded components, named spawn points, and each scene's kill plane.
  Adding a zone means adding an entry here and a scene component.
- `src/state/lessons.ts` and `src/state/progression.ts` hold the progression rules.
- `src/art/quality.ts` holds the three tiers and the pure function that guesses one from the GPU string.
  Anything expensive in the renderer reads from there rather than deciding for itself.
- `src/art/textures.ts` owns ground surfacing and the tiling density each caller asks for.
- `src/art/Grass.tsx` is the instanced grass field, and `Scatter.tsx` the rocks, pebbles and flowers around it.
- `src/game/scenes/SceneHost.tsx` is the phase machine behind travel and death.
  `irisHandle.ts` and `IrisTracker.tsx` are what keep the transition circle centred on the robot.

## Constraints worth knowing before changing things

**Bloom runs before tone mapping**, so it sees raw HDR values.
Light intensities in `Lighting.tsx` are budgeted to keep lit diffuse surfaces below the bloom threshold in `PostFX.tsx`.
Raising a light without checking that threshold makes the entire world glow rather than just the emissives.

**Scenes are discrete and only one is mounted at a time.**
Player progress survives a scene swap because it lives in the zustand store; anything held in scene components does not.
This is what keeps zones decoupled, so adding a zone later cannot regress an existing one.

**Three libraries have sharp edges that this project has already been cut on, and none of them failed loudly.**

drei's `SoftShadows` patches three's shadow shader chunk, and three 0.185 reworked those internals.
The result is not an error, it is the entire scene rendering flat white.
Soft shadows come from variance shadow maps selected on the renderer in `App.tsx` instead.
The same release deprecated `PCFSoftShadowMap`, which is the console warning that gives this away.

drei's `Cloud` must be inside a `Clouds` parent, which provides the context that batches it.
A bare `Cloud` does not render on its own.

drei's `Sky` scales its geometry by its `distance` prop, and the usual value is in the thousands, matching three's own example where the camera far plane is in the millions.
Ours is 250.
It was replaced by a palette-driven gradient dome in `src/art/SkyDome.tsx`, which is also the better call for a world whose whole look is a chosen palette.

**Ground textures ship as three files per set, not five.**
Colour, a normal map, and an ORM pack with ambient occlusion in red and roughness in green.
That packing is the glTF convention and it is load-bearing rather than a saving: three reads occlusion from a texture's red channel and roughness from its green, so one image fills two material slots.
Occlusion also has to be pinned to UV channel 0 in `textures.ts`, because it otherwise defaults to a second UV set that none of this geometry has, and then silently samples nothing.

**Stone has its albedo levelled at load, and the level is easy to get wrong.**
A colour map multiplies the material colour, so a dark photograph cannot tint a surface, it can only dim it: the rock averages around RGB(79,76,69), and used raw it made every stone surface render near black regardless of the colour it was given.
Levelling re-centres it so the palette drives colour and the photograph only supplies grain.
It has to leave headroom above the new mean, though, or the bright half of the rock clips and the stone comes out looking like flat plastic with dark speckles.

## Adding a lesson

A lesson's completion is a predicate over saved progress rather than a stored boolean:

```ts
type Lesson = {
  id: string
  zoneId: string
  title: string
  isComplete: (state: ProgressState) => boolean
}
```

Every lesson currently uses a manual completion flag.
When the approach to verifying real LLM use is chosen, it becomes one predicate implementation and nothing else changes.

Note that embedding ChatGPT, Claude, or Gemini in an iframe is not possible.
All three send `X-Frame-Options` headers that make the browser refuse to render them in a frame, so any verification approach has to work another way.

## Debugging

- `?quality=low|medium|high` forces a graphics tier. `low` turns off ambient occlusion and soft shadows and cuts grass to a ring around the player, which makes it the fastest way to tell a rendering bug from a performance one.
- `?nofx` disables post-processing. Between it and `?quality=low`, most "the world looks wrong" reports can be bisected in two reloads.
- In dev, `window.__player` exposes live position, velocity, grounded state, the coyote and buffer timers, and both camera angles.
  `camYaw - inputYaw` is how far the camera has swung on its own since the player last let go, which is the number to look at if auto-alignment ever misbehaves again.

A note on debugging this in a background tab: Chrome defers image decode and stops firing `requestAnimationFrame` when a window is occluded, so the loader sits at 0% and the opening iris never plays.
The game is fine; it is waiting for a frame that will not arrive until the window is genuinely visible.
