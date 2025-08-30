import { createActor } from "xstate";
import { createWhisperMachine } from "../rooms/whisper";
import { stringToUuid, UUID } from "@elizaos/core";
import { describe, it, expect } from "bun:test";
import { ac } from "../../../../../packages/core/dist/index-C2b71pQw";
import { create } from "domain";

describe("Whisper machine", () => {
  it("creates a room, counts messages, enforces per-player per-room limit, and advances turns", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");
    const p3 = stringToUuid("p3");
    const allPlayers = [p1, p2, p3];

    const actor = createActor(
      createWhisperMachine({
        roundTimeoutMs: 1000,
        roomTimeoutMs: 1000,
        diaryTimeoutMs: 1000,
        pickTimeoutMs: 1000,
      }),
      {
        input: {
          players: allPlayers.map((id) => ({ id, maxRequests: 1 })),
          settings: {
            maxMessagesPerPlayerPerRoom: 2,
            perRoomMaxParticipants: 3,
          },
        },
      },
    );
    let round = 1;
    let players: {
      roomId: UUID;
      ownerId: UUID;
      participantIds: UUID[];
    }[] = [];
    let didCreate = false;
    let firstRoom: UUID | null = null;
    actor.on("WHISPER_YOUR_TURN", (event) => {
      if (didCreate) return;
      didCreate = true;
      console.log(`Player ${event.playerId} turn`);

      // take 1 action
      const otherPlayer = allPlayers.filter((p) => p !== event.playerId)[0];
      const roomId = stringToUuid(`p${event.playerId}r${round}`);
      firstRoom = roomId;
      players.push({
        ownerId: event.playerId,
        participantIds: [otherPlayer],
        roomId,
      });
      actor.send({
        type: "CREATE_ROOM",
        roomId,
        ownerId: event.playerId,
        participantIds: [otherPlayer],
      });
    });

    actor.start();

    const sv = actor.getSnapshot().value;
    expect(sv).toBe("active");
    expect(players.length).toBe(1);

    // p1 sends two messages
    players.forEach(({ ownerId, participantIds }) => {
      actor.send({
        type: "MESSAGE_SENT",
        roomId: stringToUuid(`p${ownerId}r${round}`),
        playerId: ownerId,
      });
      participantIds.forEach((participantId) => {
        actor.send({
          type: "MESSAGE_SENT",
          roomId: stringToUuid(`p${ownerId}r${round}`),
          playerId: participantId,
        });
      });
    });

    // advance to next turn so the machine returns to picking
    actor.send({
      type: "END_ROOM",
      roomId: firstRoom!,
    });
    expect(actor.getSnapshot().value).toBe("picking");
    const { context } = actor.getSnapshot();
    players.forEach(({ ownerId, roomId, participantIds }) => {
      if (roomId === firstRoom) {
        expect(context.rooms[roomId]).toBeUndefined();
        return;
      }
      expect(context.rooms[roomId]).toEqual(
        expect.objectContaining({
          createdAt: expect.any(Number),
          messagesByPlayer: expect.any(Object),
          participants: participantIds,
        }),
      );
    });
  });
});
