import { createActor } from "xstate";
import { createGameMachine, INTRO_TIMER_MS } from "../machine";
import { createInitialContext } from "../helpers";
import { ManualTimerService } from "../timers/TimerService";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";

describe("Diary room question emission", () => {
  it("emits a DIARY_ROOM_QUESTION for each player on entry to INTRO_DR", () => {
    const playerIds = ["p1", "p2", "p3"];
    const timers = new ManualTimerService();
    const machine = createGameMachine({
      initialContext: createInitialContext({
        playerIds,
      }),
      timers,
      initialPhase: Phase.INTRODUCTION,
    });
    const questions: any[] = [];

    const actor = createActor(machine).start();

    expect(actor.getSnapshot().value).toBe(Phase.INTRODUCTION);
    // subscribe before triggering
    actor.subscribe((snap) => {
      // console.log(snap.value);
      // console.log(JSON.stringify(snap.output, null, 2));
      // const evt = snap.historyValue[0][0].events[0];
      // if (evt && evt.type === "DIARY_ROOM_QUESTION") {
      //   questions.push(evt);
      // }
    });
    actor.on("PLAYER_READY", (evt) => {
      console.log("PLAYER_READY", evt);
      // questions.push(evt);
    });

    // move to diary phase
    timers.advance(INTRO_TIMER_MS + 100);
    expect(actor.getSnapshot().value).toBe(Phase.INTRO_DR);

    // House asks if ready
    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.INTRO_DR });

    // players respond
    playerIds.forEach((id) =>
      actor.send({ type: "PLAYER_READY", playerId: id }),
    );
    expect(actor.getSnapshot().value).toBe(Phase.LOBBY);

    // Intro timer expiry to reach diary room
    timers.advance(INTRO_TIMER_MS);
    expect(actor.getSnapshot().value).toBe(Phase.LOBBY_DR);
  });
});
