import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";
import { pbkdf2 } from "crypto";

describe("Phase → DiaryRoom integration", () => {
  it("goes through diary phase and ends in LOBBY", () => {
    const p1 = stringToUuid("p1");
    const actor = createActor(
      createPhaseMachine({
        id: stringToUuid("game1"),
        timers: {
          diary: 1000,
          round: 1000,
          whisper: 1000,
          whisper_pick: 500,
          whisper_room: 500,
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
    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });
    // console.log(actor.getSnapshot().context);

    expect(actor.getSnapshot().value).toBe("introduction");
    actor.send({
      type: "GAME:MESSAGE_SENT",
      playerId: p1,
      messageId: stringToUuid("m1"),
    });
    actor.send({ type: "GAME:END_ROUND" });

    expect(actor.getSnapshot().value).toBe("introduction");
    expect(actor.getSnapshot().children.introduction?.getSnapshot().value).toBe(
      "strategy",
    );
    // actor.send({ type: "GAME:ARE_YOU_READY" });
    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });

    expect(actor.getSnapshot().value).toBe("lobby");

    // Respond ready, which should complete diary and go to LOBBY
    actor.send({ type: "GAME:END_ROUND" });
    expect(actor.getSnapshot().children.lobby?.getSnapshot().value).toBe(
      "strategy",
    );
    actor.send({ type: "GAME:ARE_YOU_READY" });
    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });
    expect(actor.getSnapshot().value).toBe("whisper");
  });
});
