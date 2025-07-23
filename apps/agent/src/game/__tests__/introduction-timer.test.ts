import { createActor } from "xstate";
import { describe, it, expect } from "bun:test";
import { createGameplayMachine } from "../gameplay";
import { stringToUuid } from "@elizaos/core";
import { Phase } from "../types";

describe("INTRODUCTION timer fallback", () => {
  it("transitions to LOBBY when timer expires if not all introduced", () => {
    const playerIds = ["p1", "p2"].map(stringToUuid);
    const actor = createActor(
      createGameplayMachine({
        phaseTimeoutMs: 60000,
        readyTimerMs: 10000,
      }),
      {
        input: {
          players: playerIds,
          initialPhase: Phase.INIT,
          nextPhase: Phase.INTRODUCTION,
        },
      },
    ).start();

    // Players indicate readiness
    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: "p1" });
    actor.send({ type: "PLAYER_READY", playerId: "p2" });

    expect(actor.getSnapshot().value).toBe("gameplay");
  });
});
