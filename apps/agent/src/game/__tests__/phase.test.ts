import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";

describe("Phase → DiaryRoom integration", () => {
  it("goes through diary phase and ends in LOBBY", () => {
    const p1 = stringToUuid("p1");
    const actor = createActor(
      createPhaseMachine({
        id: stringToUuid("game1"),
        timers: {
          diary: 1000,
          round: 1000,
        },
      }),
      {
        input: {
          players: [p1],
          maxPlayers: 2,
          minPlayers: 1,
        },
      },
    ).start();

    expect(actor.getSnapshot().value).toBe("init");

    actor.send({ type: "PLAYER_READY", playerId: p1 });

    expect(actor.getSnapshot().value).toBe("introduction");
    actor.send({
      type: "MESSAGE_SENT",
      playerId: p1,
      messageId: stringToUuid("m1"),
    });
    actor.send({ type: "END_ROUND" });
    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: p1 });
    expect(actor.getSnapshot().value).toBe("lobby");

    // Respond ready, which should complete diary and go to LOBBY
    actor.send({ type: "END_ROUND" });
    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: p1 });
    expect(actor.getSnapshot().value).toBe("whisper");
  });
});
