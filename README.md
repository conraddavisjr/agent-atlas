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
| WASD or arrow keys | Move, relative to the camera |
| Space | Jump, with variable height |
| Mouse drag | Orbit the camera |
| E or Enter | Interact with the totem you are standing at |
| Gamepad | Left stick moves, A jumps, X interacts, right stick orbits |

The camera swings back behind the direction you are travelling on its own.
Dragging always wins while you are dragging, and auto-alignment resumes the moment you move again, with no cooldown in between.

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
- `src/art/textures.ts` owns the stone surfacing, including the tiling density each caller asks for.
- `src/game/scenes/SceneHost.tsx` is the phase machine behind travel and death.
  `irisHandle.ts` and `IrisTracker.tsx` are what keep the transition circle centred on the robot.

## Three constraints worth knowing before changing things

**Bloom runs before tone mapping**, so it sees raw HDR values.
Light intensities in `Lighting.tsx` are budgeted to keep lit diffuse surfaces below the bloom threshold in `PostFX.tsx`.
Raising a light without checking that threshold makes the entire world glow rather than just the emissives.

**Scenes are discrete and only one is mounted at a time.**
Player progress survives a scene swap because it lives in the zustand store; anything held in scene components does not.
This is what keeps zones decoupled, so adding a zone later cannot regress an existing one.

**One stone photograph ships, and the maps the renderer uses are derived from it at load time.**
`src/art/textures.ts` builds the normal and roughness maps with a Sobel pass, and levels the albedo so the palette drives colour while the photograph only supplies grain.
Two numbers in there are easy to get wrong and hard to diagnose from the map itself.
The Sobel output must be normalised by the kernel maximum rather than by 255, or the surface normals tip almost flat and every stone surface renders near black.
And the levelled albedo has to leave headroom above its mean, or the bright half of the rock clips and the stone comes out looking like flat plastic.

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

- `?nofx` disables post-processing. First thing to try if the game runs badly or looks wrong on unfamiliar hardware.
- In dev, `window.__player` exposes live position, velocity, grounded state, and the coyote and buffer timers.
