import { createActor } from "xstate";
import { createWhisperMachine } from "../rooms/whisper";
import { stringToUuid, UUID } from "@elizaos/core";
import { describe, it, expect } from "bun:test";

describe("Whisper rooms lifecycle", () => {
  it("closes room when owner leaves and when last participant leaves", () => {
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
          settings: {
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    const roomId = stringToUuid("r-owner-leave");

    // create room with owner p1 and participant p2
    actor.send({
      type: "GAME:CREATE_ROOM",
      ownerId: p1,
      participantIds: [p1, p2],
    });

    // room exists
    let ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeDefined();

    // owner leaves -> room should be closed (removed)
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p1 });
    ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeUndefined();

    // create another room and make the non-owner leave until empty
    const room2 = stringToUuid("r-last-leave");
    actor.send({
      type: "GAME:CREATE_ROOM",
      ownerId: p2,
      participantIds: [p2, p1],
    });
    ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeDefined();

    // p1 leaves (participant) -> room should remain because owner p2 is still present
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p1 });
    ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeDefined();

    // p2 (owner) leaves -> room should be removed
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p2 });
    ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeUndefined();
  });
});
