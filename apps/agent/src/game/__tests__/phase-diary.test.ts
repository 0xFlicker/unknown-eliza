import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";

describe("Phase → DiaryRoom integration", () => {
  it("goes through diary phase and ends in LOBBY", () => {
    const p1 = stringToUuid("p1");
    const actor = createActor(
      createPhaseMachine({ phaseTimeoutMs: 1000, readyTimerMs: 1000 }),
      {
        input: {
          players: [p1],
          initialPhase: Phase.INIT,
          nextPhase: Phase.INTRODUCTION,
        },
      },
    ).start();

    // INIT → INTRODUCTION
    actor.send({ type: "PLAYER_READY", playerId: p1 });

    expect(actor.getSnapshot().value).toBe("gameplay");

    // INTRODUCTION → INTRODUCTION_DR (diary invoked)
    // Trigger diary: ask if ready
    actor.send({ type: "END_ROUND" });
    const snapshot2 = actor.getSnapshot().value;
    expect(snapshot2).toBe("diary");

    // Respond ready, which should complete diary and go to LOBBY
    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: p1 });
    expect(actor.getSnapshot().value).toBe("strategy");
  });
});
