import { createActor } from "xstate";
import { createGameMachine, INTRO_TIMER_MS } from "../machine";
import { createInitialContext } from "../helpers";
import { ManualTimerService } from "../timers/TimerService";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";

describe("INTRODUCTION timer fallback", () => {
  it("transitions to LOBBY when timer expires if not all introduced", () => {
    const playerIds = ["p1", "p2"];
    const timers = new ManualTimerService();
    const actor = createActor(
      createGameMachine({
        initialContext: createInitialContext({ playerIds }),
        timers,
        initialPhase: Phase.INTRODUCTION,
      }),
    ).start();

    // Players indicate readiness
    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.LOBBY });
    actor.send({ type: "PLAYER_READY", playerId: "p1" });
    actor.send({ type: "PLAYER_READY", playerId: "p2" });

    expect(actor.getSnapshot().value).toBe(Phase.INTRODUCTION);

    // Only first player sends intro message
    actor.send({ type: "INTRO_MESSAGE", playerId: "p1" });
    expect(actor.getSnapshot().value).toBe(Phase.INTRODUCTION);

    // advance first timer -> should reach diary room state
    timers.advance(INTRO_TIMER_MS);
    expect(actor.getSnapshot().value).toBe(Phase.INTRO_DR);

    // House asks if ready but players never respond -> ready timer expires
    actor.send({ type: "ARE_YOU_READY", nextPhase: Phase.LOBBY });
    expect(actor.getSnapshot().value).toBe(Phase.INTRO_DR);
    timers.advance(INTRO_TIMER_MS);
    expect(actor.getSnapshot().value).toBe(Phase.LOBBY);
  });
});
