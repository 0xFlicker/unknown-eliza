import { createActor } from "xstate";
import { createWhisperMachine } from "../rooms/whisper";
import { stringToUuid } from "@elizaos/core";
import { describe, it, expect } from "bun:test";

// This test ensures that rounds advance and machine reaches end when no remaining requests
describe("Whisper rounds and exhaustion", () => {
  it("advances rounds and ends when all requests exhausted", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");

    const actor = createActor(
      createWhisperMachine({
        roundTimeoutMs: 1000,
        roomTimeoutMs: 1000,
        diaryTimeoutMs: 1000,
        pickTimeoutMs: 1000,
      }),
      {
        input: {
          players: [
            { id: p1, maxRequests: 1 },
            { id: p2, maxRequests: 1 },
          ],
          settings: { maxMessagesPerPlayerPerRoom: 5 },
        },
      },
    ).start();

    // create a room so active state is relevant
    const roomId = stringToUuid("r-rounds");
    actor.send({
      type: "CREATE_ROOM",
      roomId,
      ownerId: p1,
      participantIds: [p1, p2],
    });

    actor.send({ type: "END_ROOM", roomId: roomId });
    const room2 = stringToUuid("r-rounds-2");
    actor.send({
      type: "CREATE_ROOM",
      roomId: room2,
      ownerId: p1,
      participantIds: [p1, p2],
    });
    actor.send({ type: "END_ROOM", roomId: room2 });
    const room3 = stringToUuid("r-rounds-3");
    actor.send({
      type: "CREATE_ROOM",
      roomId: room3,
      ownerId: p2,
      participantIds: [p2, p1],
    });

    actor.send({ type: "END_ROOM", roomId: room3 });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("diary");

    actor.send({ type: "ARE_YOU_READY" });
    actor.send({ type: "PLAYER_READY", playerId: p1 });
    actor.send({ type: "PLAYER_READY", playerId: p2 });
    expect(actor.getSnapshot().value).toBe("end");
  });
});
