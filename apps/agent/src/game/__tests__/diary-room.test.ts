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
    const machine = createGameMachine(createInitialContext(playerIds), timers);
    const questions: any[] = [];

    const actor = createActor(machine).start();
    // subscribe before triggering
    actor.subscribe((snap) => {
      const evt = (snap as any).event;
      if (evt && evt.type === "DIARY_ROOM_QUESTION") {
        questions.push(evt);
      }
    });

    // move to diary phase
    timers.advance(INTRO_TIMER_MS);

    // House asks if ready
    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.LOBBY });

    // players respond
    playerIds.forEach((id) =>
      actor.send({ type: "PLAYER_READY", playerId: id }),
    );
    expect(actor.getSnapshot().matches(Phase.LOBBY)).toBe(true);

    // Intro timer expiry to reach diary room
    timers.advance(INTRO_TIMER_MS);
    expect(actor.getSnapshot().matches(Phase.INTRO_DR)).toBe(true);
    const ctx = actor.getSnapshot().context;
    expect(Object.keys(ctx.diaryRooms ?? {}).length).toBe(playerIds.length);
  });
});
