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
      ownerId: UUID;
      participantIds: UUID[];
    }[] = [];
    let didCreate = false;
    actor.on("GAME:WHISPER_YOUR_TURN", (event) => {
      if (didCreate) return;
      didCreate = true;
      console.log(`Player ${event.playerId} turn`);

      // take 1 action
      const otherPlayer = allPlayers.filter((p) => p !== event.playerId)[0];
      players.push({
        ownerId: event.playerId,
        participantIds: [otherPlayer],
      });
      actor.send({
        type: "GAME:CREATE_ROOM",
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
        type: "GAME:MESSAGE_SENT",
        playerId: ownerId,
      });
      participantIds.forEach((participantId) => {
        actor.send({
          type: "GAME:MESSAGE_SENT",
          playerId: participantId,
        });
      });
    });

    // advance to next turn so the machine returns to picking
    actor.send({
      type: "GAME:END_ROOM",
    });
    expect(actor.getSnapshot().value).toBe("picking");
    const { context } = actor.getSnapshot();
    expect(context.activeRoom).toBeUndefined();
  });
  it("blocks CREATE_ROOM when owner lacks requests", () => {
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
            { id: p1, maxRequests: 0 }, // no requests
            { id: p2, maxRequests: 1 },
          ],
          settings: {
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    const roomId = stringToUuid("r-block-create");

    actor.send({
      type: "GAME:CREATE_ROOM",
      ownerId: p1,
      participantIds: [p1, p2],
    });

    const ctx = actor.getSnapshot().context;
    expect(ctx.activeRoom).toBeUndefined();
    expect(ctx.remainingRequests[p1]).toBe(0);
  });

  it("decrements remainingRequests only on CREATE_ROOM and by correct amount", () => {
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
            { id: p1, maxRequests: 2 },
            { id: p2, maxRequests: 1 },
          ],
          settings: {
            maxMessagesPerPlayerPerRoom: 5,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    actor.send({
      type: "GAME:CREATE_ROOM",
      ownerId: p1,
      participantIds: [p1, p2],
    });
    expect(actor.getSnapshot().context.remainingRequests[p1]).toBe(1);

    // MESSAGE_SENT should not change remainingRequests
    actor.send({ type: "GAME:MESSAGE_SENT", playerId: p1 });
    expect(actor.getSnapshot().context.remainingRequests[p1]).toBe(1);
  });

  it("PASS forfeits current player's remainingRequests and emits next player's turn", () => {
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
            perRoomMaxParticipants: 2,
          },
        },
      },
    );

    let sawYourTurnForNext = false;
    actor.on("GAME:WHISPER_YOUR_TURN", (ev) => {
      // first time will be for p1; let test send PASS
      if (ev.playerId === p2) sawYourTurnForNext = true;
    });

    actor.start();
    // ensure we're in picking and current is p1
    const current =
      actor.getSnapshot().context.turnOrder[
        actor.getSnapshot().context.currentTurnIndex
      ];
    expect(current).toBeDefined();

    actor.send({ type: "GAME:PASS", playerId: current });

    expect(actor.getSnapshot().context.remainingRequests[current]).toBe(0);
    // because we emitted next player's turn synchronously via emitYourTurn, we should have seen it already
    expect(sawYourTurnForNext).toBeTruthy();
  });

  it("pick-timeout forfeits and advances to next picker/round", async () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");

    const actor = createActor(
      createWhisperMachine({
        roundTimeoutMs: 1000,
        roomTimeoutMs: 1000,
        diaryTimeoutMs: 1000,
        pickTimeoutMs: 20,
      }),
      {
        input: {
          players: [
            { id: p1, maxRequests: 1 },
            { id: p2, maxRequests: 1 },
          ],
          settings: {
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 2,
          },
        },
      },
    ).start();

    const startPlayer =
      actor.getSnapshot().context.turnOrder[
        actor.getSnapshot().context.currentTurnIndex
      ];
    await new Promise((r) => setTimeout(r, 50));

    const after = actor.getSnapshot();
    // startPlayer should have remainingRequests 0
    expect(after.context.remainingRequests[startPlayer]).toBe(0);
    // machine should have proceeded (either to picking another player or diary)
    expect(after.value).toBe("pick-timeout");
  });
});
