import { describe, expect, it } from "vitest";
import {
  FACE_INSET,
  WITHDRAW_FRACTION,
  cubeDescent,
  cubePosition,
  cubeRise,
} from "./cube";
import {
  DURATIONS,
  PHASES,
  initialTrainingState,
  type Phase,
  type TrainingState,
} from "./trainingMachine";
import {
  CUBE_AT,
  CUBE_DROP_FROM,
  CUBE_QUIZ_AT,
  CUBE_SIZE,
  EYE,
  FIRST_PERSON_FOV,
  PLANK_RADIUS,
} from "./stage";
import { LABEL_HALF_HEIGHT, LABEL_LIFT, plankLayout } from "./quiz";
import { cameraPose } from "./cameraDirector";
import { headlineVisible } from "./diorama";

const at = (over: Partial<TrainingState>): TrainingState => ({
  ...initialTrainingState(),
  ...over,
});

describe("the descent", () => {
  it("stays out of the room for the whole of the teaching", () => {
    /*
      It arrives LATE now. `cubeIn` sits after the reading rather than before it,
      because the diorama has the floor until the question - one object per act.
    */
    for (const phase of [
      "arriving",
      "instructorIn",
      "speech1",
      "speech2",
      "instructorOut",
      "dioramaIn",
      "reading",
      "swapping",
    ] as const) {
      expect(cubeDescent(at({ phase })), phase).toBe(0);
    }
  });

  it("arrives across cubeIn and stays down afterwards", () => {
    const duration = DURATIONS.cubeIn ?? 1;
    expect(cubeDescent(at({ phase: "cubeIn", elapsed: 0 }))).toBe(0);
    expect(cubeDescent(at({ phase: "cubeIn", elapsed: duration }))).toBeCloseTo(
      1,
      12,
    );
    for (const phase of [
      "question",
      "arming",
      "aiming",
      "celebrating",
      "exiting",
    ] as const) {
      expect(cubeDescent(at({ phase })), phase).toBe(1);
    }
  });

  it("does not arrive a second time when a shot misses", () => {
    /*
      The quiz loop runs `aiming -> firing -> rejecting -> reloading -> aiming`,
      so any rule that read the phase list's ORDER would have the board drop in
      again on every miss. It is a set membership instead.
    */
    for (const phase of ["firing", "rejecting", "reloading"] as const) {
      expect(cubeDescent(at({ phase, elapsed: 0.2 })), phase).toBe(1);
    }
  });

  it("faces the camera, which is the side this stage keeps getting wrong", () => {
    /*
      Authored at +Z, viewed from -Z. The headline rendered mirrored, the cube
      opened on the quiz face, all three plank verdicts showed before a shot, the
      hat's tip flopped out of sight and the moustache curled the wrong way - all
      the same inversion. `FACE_INSET` carries its sign in its own doc for that
      reason, and this is the assertion behind it.
    */
    expect(FACE_INSET).toBeLessThan(0);
  });

  it("lands exactly on its resting place, not near it", () => {
    const rest = cubePosition(1);
    expect(rest[0]).toBeCloseTo(CUBE_AT[0], 12);
    expect(rest[1]).toBeCloseTo(CUBE_AT[1], 12);
    expect(rest[2]).toBeCloseTo(CUBE_AT[2], 12);

    const start = cubePosition(0);
    expect(start[1]).toBeCloseTo(CUBE_DROP_FROM[1], 12);
  });

  it("only ever comes down", () => {
    // A descent that rose partway would read as the cube bouncing on nothing.
    let previous = cubePosition(0)[1];
    for (let i = 1; i <= 100; i++) {
      const y = cubePosition(i / 100)[1];
      expect(y).toBeLessThanOrEqual(previous + 1e-12);
      previous = y;
    }
  });
});

describe("the rise, which is the quiz layout", () => {
  it("is down for the question and gone for every beat of the quiz", () => {
    for (const phase of [
      "arriving",
      "instructorIn",
      "dioramaIn",
      "reading",
      "cubeIn",
      "question",
    ] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(0);
    }
    for (const phase of [
      "aiming",
      "firing",
      "rejecting",
      "reloading",
      "accepting",
      "celebrating",
    ] as const) {
      expect(cubeRise(at({ phase })), phase).toBe(1);
    }
  });

  it("is finished well before the camera reaches the eye", () => {
    /*
      The camera crosses five metres during `arming` and the cube stands at z 3.6,
      directly between where it starts and where it ends. A board still rising
      when the camera lands is a wall passing the lens.
    */
    const duration = DURATIONS.arming ?? 2.2;
    expect(
      cubeRise(at({ phase: "arming", elapsed: duration * WITHDRAW_FRACTION })),
    ).toBeCloseTo(1, 9);
    expect(WITHDRAW_FRACTION).toBeLessThan(0.6);
  });

  it("never rises while it is still coming down", () => {
    /*
      The two motions share one position, so an overlap would be the cube
      travelling diagonally out of the sky - and the drop is authored as a drop.
      Stated as an invariant over every phase rather than checked on the two that
      happen to matter today.
    */
    for (const phase of PHASES) {
      const state = at({ phase, elapsed: 0.3 });
      if (cubeDescent(state) < 1) expect(cubeRise(state), phase).toBe(0);
    }
  });

  it("lands exactly on the withdrawn pose", () => {
    const rest = cubePosition(1, 1);
    expect(rest[0]).toBeCloseTo(CUBE_QUIZ_AT[0], 12);
    expect(rest[1]).toBeCloseTo(CUBE_QUIZ_AT[1], 12);
    expect(rest[2]).toBeCloseTo(CUBE_QUIZ_AT[2], 12);
  });

  it("leaves the frame entirely, rather than merely getting out of the way", () => {
    /*
      **This is the test the withdrawal exists for.**

      An earlier staging kept the cube in shot and lifted it just enough to clear
      the answer labels. That worked from five metres behind the player and cannot
      work from the player's own eye - a 2.1 m board at z 3.6 fills the middle of
      a first-person frame and the plank column is behind it.

      So the bar is not "above the labels", it is "outside the frame": the cube's
      LOWEST corner has to sit past the top of a `FIRST_PERSON_FOV` view from
      `EYE`. Anything less and a corner of the board hangs over the question the
      HUD is now carrying.
    */
    const [, y, z] = cubePosition(1, 1);
    const bottom = y - CUBE_SIZE / 2;
    const angle = (Math.atan2(bottom - EYE[1], z - EYE[2]) * 180) / Math.PI;
    expect(angle, "the withdrawn cube is still in shot").toBeGreaterThan(
      FIRST_PERSON_FOV / 2,
    );
  });
});

describe("the quiz camera frames the whole beat", () => {
  /*
    The pose is derived from the layout in a comment, and a comment cannot fail.
    This walks the actual arithmetic: everything the player has to see has to fall
    inside half the vertical field of view, measured from the camera's own axis.
  */
  const degreesAbove = (
    pose: ReturnType<typeof cameraPose>,
    y: number,
    z: number,
  ) => {
    const axis = Math.atan2(
      pose.lookAt[1] - pose.position[1],
      pose.lookAt[2] - pose.position[2],
    );
    return (
      ((Math.atan2(y - pose.position[1], z - pose.position[2]) - axis) * 180) /
      Math.PI
    );
  };

  it("holds the whole answer column and its labels inside the frame", () => {
    /*
      Three coins, three labels, from the eye. The label is the part that gets
      forgotten: it hangs above its plank, so the TOP of the frame is set by a
      piece of text rather than by any geometry, and a column that fits by disc
      alone can still crop the answer the player is reading.
    */
    const pose = cameraPose("aiming");
    const half = pose.fov / 2;
    const planks = plankLayout();

    const top = degreesAbove(
      pose,
      planks[0][1] + LABEL_LIFT + LABEL_HALF_HEIGHT,
      planks[0][2],
    );
    const bottom = degreesAbove(
      pose,
      planks[2][1] - PLANK_RADIUS,
      planks[2][2],
    );
    expect(top, "the top label is cropped").toBeLessThan(half);
    expect(bottom, "the bottom plank is cropped").toBeGreaterThan(-half);
  });

  it("centres on the middle answer, so the level shot is not the easy one", () => {
    /*
      A column whose centre sat above the eye would make shooting level - the
      thing a bow naturally does - land on the bottom answer every time. The
      middle plank is dead ahead instead, and the outer two are symmetric about
      it.
    */
    const pose = cameraPose("aiming");
    const planks = plankLayout();
    expect(degreesAbove(pose, planks[1][1], planks[1][2])).toBeCloseTo(0, 6);
    const up = degreesAbove(pose, planks[0][1], planks[0][2]);
    const down = degreesAbove(pose, planks[2][1], planks[2][2]);
    expect(up).toBeCloseTo(-down, 6);
  });

  it("takes the headline out of the quiz entirely", () => {
    /*
      **This test used to assert the opposite, and the reversal is the point.**

      The headline was kept in shot through the shooting, justified as "the only
      thing above the coins, the cube having left", and it was raised to a parking
      height so the top answer's label could clear it. That whole arrangement
      existed to resolve a collision between two pieces of text that no longer
      share a frame.

      The sign's job is the arrival - it tells a player dropped into a room they
      did not build why they are standing there - and from the first reading card
      onward the HUD's own scene card says the same words in DOM. So it climbs out
      with the wizard on `instructorOut`, and the thing above the coins is now
      `TrainingHUD`'s question banner, which was already there.
    */
    const quizBeats: Phase[] = [
      "dioramaIn",
      "reading",
      "question",
      "arming",
      "aiming",
      "celebrating",
    ];
    for (const phase of quizBeats) {
      expect(
        headlineVisible({ ...initialTrainingState(), phase }),
        `the headline is back in ${phase}`,
      ).toBe(false);
    }
  });
});
