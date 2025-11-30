import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { stringToUuid, UUID } from "@elizaos/core";
import { describe, it, expect } from "bun:test";
import { Phase } from "../types";

describe("Whisper rooms lifecycle", () => {
  it("closes room when owner leaves and when last participant leaves", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");

    const actor = createActor(
      createPhaseMachine({
        id: stringToUuid("game1"),
        timers: {
          whisper: 1000,
          whisper_pick: 1000,
          whisper_room: 1000,
          diary: 1000,
          diary_response: 1000,
          diary_ready: 1000,
          diary_prompt: 1000,
          round: 1000,
        },
      }),
      {
        input: {
          playerSettings: [
            {
              agentId: p1,
              diaryRoomId: stringToUuid("diary1"),
            },
            {
              agentId: p2,
              diaryRoomId: stringToUuid("diary2"),
            },
          ],
          minPlayers: 2,
          maxPlayers: 3,
          startPhase: Phase.WHISPER,
          whisperSettings: {
            requestsPerPlayer: 1,
            maxMessagesPerPlayerPerRoom: 5,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    const roomId = stringToUuid("r-owner-leave");

    // create room with owner p1 and participant p2
    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: stringToUuid("r-owner-leave"),
      ownerId: p1,
      participantIds: [p1, p2],
    });

    // room exists
    let ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeDefined();

    // owner leaves -> room should be closed (removed)
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p1 });
    ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeUndefined();

    // create another room and make the non-owner leave until empty
    const room2 = stringToUuid("r-last-leave");
    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: room2,
      ownerId: p2,
      participantIds: [p2, p1],
    });
    ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeDefined();

    // p1 leaves (participant) -> room should remain because owner p2 is still present
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p1 });
    ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeDefined();

    // p2 (owner) leaves -> room should be removed
    actor.send({ type: "GAME:LEAVE_ROOM", playerId: p2 });
    ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeUndefined();
  });
});
