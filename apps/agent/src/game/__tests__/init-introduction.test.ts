import { createActor } from "xstate";
import { createGameMachine } from "../machine";
import { createInitialContext } from "../helpers";
import { ManualTimerService } from "../timers/TimerService";
import { Phase } from "../types";

import { describe, it, expect } from "bun:test";

describe("INIT → INTRODUCTION transition", () => {
  it("transitions once all players are ready", () => {
    const playerIds = ["p1", "p2", "p3"];

    const timers = new ManualTimerService();
    const machine = createGameMachine({
      initialContext: createInitialContext({ playerIds }),
      timers,
      initialPhase: Phase.INIT,
    });
    const actor = createActor(machine).start();
    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.INTRODUCTION });

    // First player ready – should still be in INIT
    actor.send({ type: "PLAYER_READY", playerId: "p1" });
    expect(actor.getSnapshot().value).toBe(Phase.INIT);

    // Second player ready – still INIT
    actor.send({ type: "PLAYER_READY", playerId: "p2" });
    expect(actor.getSnapshot().value).toBe(Phase.INIT);

    // Last player ready – should transition
    actor.send({ type: "PLAYER_READY", playerId: "p3" });

    expect(actor.getSnapshot().value).toBe(Phase.INTRODUCTION);
  });

  it("ignores duplicate ready messages", () => {
    const playerIds = ["a", "b"];
    const timers = new ManualTimerService();
    const actor = createActor(
      createGameMachine({
        initialContext: createInitialContext({ playerIds }),
        timers,
        initialPhase: Phase.INIT,
      }),
    ).start();

    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.INTRODUCTION });
    actor.send({ type: "PLAYER_READY", playerId: "a" });
    actor.send({ type: "PLAYER_READY", playerId: "a" }); // duplicate
    expect(actor.getSnapshot().value).toBe(Phase.INIT);

    actor.send({ type: "PLAYER_READY", playerId: "b" });
    expect(actor.getSnapshot().value).toBe(Phase.INTRODUCTION);
  });
});
