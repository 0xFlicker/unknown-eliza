import { createActor } from "xstate";
import { Phase } from "../types";

import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";
import { createPhaseMachine } from "../phase";

describe("INIT → INTRODUCTION transition", () => {
  it("transitions once all players are ready", () => {
    const playerIds = ["p1", "p2", "p3"].map(stringToUuid);
    const actor = createActor(
      createPhaseMachine({
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
    actor.send({ type: "ARE_YOU_READY" });

    // First player ready – should still be in INIT
    actor.send({ type: "PLAYER_READY", playerId: "p1" });
    expect(actor.getSnapshot().value).toBe("gameplay");

    // Second player ready – still INIT
    actor.send({ type: "PLAYER_READY", playerId: "p2" });
    expect(actor.getSnapshot().value).toBe("gameplay");

    // Last player ready – should transition
    actor.send({ type: "PLAYER_READY", playerId: "p3" });

    expect(actor.getSnapshot().value).toBe("gameplay");
  });

  it("ignores duplicate ready messages", () => {
    const playerIds = ["a", "b"].map(stringToUuid);
    const actor = createActor(
      createPhaseMachine({
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
    );

    actor.start();

    expect(actor.getSnapshot().value).toBe("gameplay");
    actor.send({ type: "END_ROUND" });

    expect(actor.getSnapshot().value).toBe("diary");
    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: stringToUuid("a") });
    actor.send({ type: "PLAYER_READY", playerId: stringToUuid("a") }); // duplicate
    actor.send({ type: "PLAYER_READY", playerId: stringToUuid("b") });
    expect(actor.getSnapshot().value).toBe("strategy");
    actor.send({ type: "PLAYER_READY", playerId: stringToUuid("a") });
    actor.send({ type: "PLAYER_READY", playerId: stringToUuid("b") });
    expect(actor.getSnapshot()?.value).toBe("end");
  });
});
