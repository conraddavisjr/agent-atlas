import { Suspense, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Group } from "three";
import { HEADLINE, HEADLINE_AT, HEADLINE_QUIZ_Y, HEADLINE_SIZE } from "./stage";
import { cubeRise } from "./cube";
import type { TrainingState } from "./trainingMachine";

/**
 * `WHAT IS AI?`, standing large at the back of the stage.
 *
 * ## The Suspense wrapper is the whole reason this is its own file
 *
 * drei's `<Text>` SUSPENDS. It calls `suspend(() => preloadFont(...))` internally,
 * and with no `font` prop it fetches troika's default face from a CDN at runtime -
 * there is no bundled font in this project and no `preloadFont` call anywhere.
 *
 * That matters more here than it looks. `App.tsx` puts the scene and `SceneReady`
 * as siblings inside ONE `<Suspense fallback={null}>`, and `SceneReady`'s mount is
 * what tells the travel machine the scene has arrived. A `<Text>` at scene top
 * level therefore puts a network request on the critical path of the iris hold: a
 * slow CDN means the iris does not open, and the player sits looking at a closed
 * transition with nothing reporting why.
 *
 * The local boundary below is what stops that. A stall degrades to "the headline
 * arrives a moment late" instead of "the scene never appears", because this
 * subtree suspends against its OWN fallback rather than against the one holding
 * the round together.
 *
 * The honest fix is still to bundle a font and preload it at boot, and that is a
 * binary asset decision rather than a code one. Until then this is the mitigation,
 * and `TrainingHUD` carries the same words as DOM so the round is legible even if
 * this never resolves at all.
 *
 * ## Why it cannot bloom, and why that is deliberate
 *
 * troika's material is unlit, so what is written here is what lands. `#7e93b8` is
 * well under the 1.45 threshold, which is what keeps this out of the bloom budget:
 * `00-art-bible.md` reserves tier A for ally blue and reward gold - "nothing in
 * the environment is allowed in" - and a glowing headline would read as a thing
 * the player had earned rather than as a sign on a wall.
 *
 * ## It climbs out of the way, and moving it beats fading it
 *
 * The headline is a sign at the back of the stage, and a sign that dissolves when
 * the lesson starts is a sign that was never really there. So it rises instead -
 * see `headlineLift`, which raises it for the teaching and for the quiz and
 * leaves it low only for the arrival, when it is the whole point of the frame.
 *
 * The alternative was fading it out, and it was rejected on cost as much as on
 * taste: troika's opacity lives in `fillOpacity` / `outlineOpacity`, which need a
 * `sync()` to take effect, so a smooth fade is a text re-sync every frame for the
 * length of it. Moving a `<group>` is a matrix write.
 */
export function Headline({ run }: { run: RefObject<TrainingState> }) {
  const group = useRef<Group>(null);

  useFrame(() => {
    const state = run.current;
    if (!state || !group.current) return;
    const rise = cubeRise(state);
    group.current.position.y =
      HEADLINE_AT[1] + (HEADLINE_QUIZ_Y - HEADLINE_AT[1]) * rise;
  });

  return (
    <Suspense fallback={null}>
      <group ref={group} position={HEADLINE_AT}>
        <Text
          position={[0, 0, 0]}
          /*
          Turned to FACE the camera, and without this it renders mirrored.

          troika's text faces +Z in its own space, and every camera in this round
          sits at negative Z looking toward positive Z - so an unrotated headline
          standing at the back of the stage shows the player its back, and the
          word reads right to left. It rendered as a clean, well-kerned, perfectly
          reversed `WHAT IS AI?`.

          The half turn is the same one `faceYaw` needs on the cube and for the
          same reason: this stage is authored at +Z and viewed from -Z, so
          anything that should be read has to be turned to meet the viewer.
        */
          rotation={[0, Math.PI, 0]}
          fontSize={HEADLINE_SIZE}
          color="#7e93b8"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.06}
          /*
          The outline treatment copied from `LessonTotem.tsx` and `Portal.tsx`,
          which are the only other `<Text>` in the project. Same width, same
          `#0b1020`. Not because those numbers are sacred but because three
          different outlines on three pieces of text is how a world stops looking
          like one world.
        */
          outlineWidth={0.03}
          outlineColor="#0b1020"
        >
          {HEADLINE}
        </Text>
      </group>
    </Suspense>
  );
}
