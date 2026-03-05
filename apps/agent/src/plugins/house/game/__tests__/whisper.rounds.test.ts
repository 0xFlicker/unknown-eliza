import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { stringToUuid } from "@elizaos/core";
import { describe, it, expect } from "bun:test";
import { Phase } from "../types";

// This test ensures that rounds advance and machine reaches end when no remaining requests
describe("Whisper rounds and exhaustion", () => {
  it("advances rounds and ends when all requests exhausted", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");

    const actor = createActor(
      createPhaseMachine({
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
          gameId: stringToUuid("game-123"),
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
            whisperRoomTimeoutMs: 100,
            maxWhisperRequests: 1,
            maxMessagesPerPlayerPerRoom: 5,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    // create a room so active state is relevant

    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: stringToUuid("r1"),
      ownerId: p1,
      participantIds: [p1, p2],
    });

    expect(actor.getSnapshot().context.whisper?.activeRoom).toBeDefined();
    actor.send({ type: "GAME:END_ROOM", roomId: stringToUuid("r1") });
    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: stringToUuid("r2"),
      ownerId: p1,
      participantIds: [p1, p2],
    });
    actor.send({ type: "GAME:END_ROOM", roomId: stringToUuid("r2") });
    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: stringToUuid("r3"),
      ownerId: p2,
      participantIds: [p2, p1],
    });

    actor.send({ type: "GAME:END_ROOM", roomId: stringToUuid("r3") });

    const snap = actor.getSnapshot();
    expect(snap.value).toEqual({ whisper: "diary" });

    actor.send({ type: "GAME:ARE_YOU_READY" });
    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });
    actor.send({ type: "GAME:PLAYER_READY", playerId: p2 });

    expect(actor.getSnapshot().value).toEqual({ whisper: "end" });
  });
});
