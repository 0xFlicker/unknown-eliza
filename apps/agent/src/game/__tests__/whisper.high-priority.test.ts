import { createActor } from "xstate";
import { createWhisperMachine } from "../rooms/whisper";
import { stringToUuid, UUID } from "@elizaos/core";
import { describe, it, expect } from "bun:test";

// High-priority tests: guards and core flows
describe("Whisper high-priority guards and flows", () => {
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
      type: "CREATE_ROOM",
      roomId,
      ownerId: p1,
      participantIds: [p1, p2],
    });

    const ctx: any = actor.getSnapshot().context;
    expect(ctx.rooms[roomId]).toBeUndefined();
    expect(ctx.remainingRequests[p1]).toBe(0);
  });

  it("blocks CREATE_ROOM when participant list too large or missing owner / has duplicates", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");
    const p3 = stringToUuid("p3");

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
            { id: p3, maxRequests: 1 },
          ],
          settings: {
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 2,
          },
        },
      },
    ).start();

    const r1 = stringToUuid("r-too-big");
    actor.send({
      type: "CREATE_ROOM",
      roomId: r1,
      ownerId: p1,
      participantIds: [p1, p2, p3],
    });
    expect(actor.getSnapshot().context.rooms[r1]).toBeUndefined();

    const r2 = stringToUuid("r-missing-owner");
    actor.send({
      type: "CREATE_ROOM",
      roomId: r2,
      ownerId: p1,
      participantIds: [p2],
    });
    expect(actor.getSnapshot().context.rooms[r2]).toBeUndefined();

    const r3 = stringToUuid("r-duplicate");
    actor.send({
      type: "CREATE_ROOM",
      roomId: r3,
      ownerId: p1,
      participantIds: [p1, p1],
    });
    expect(actor.getSnapshot().context.rooms[r3]).toBeUndefined();
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

    const r1 = stringToUuid("r-decr-1");
    actor.send({
      type: "CREATE_ROOM",
      roomId: r1,
      ownerId: p1,
      participantIds: [p1, p2],
    });
    expect(actor.getSnapshot().context.remainingRequests[p1]).toBe(1);

    // MESSAGE_SENT should not change remainingRequests
    actor.send({ type: "MESSAGE_SENT", roomId: r1, playerId: p1 });
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
    actor.on("WHISPER_YOUR_TURN", (ev) => {
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

    actor.send({ type: "PASS", playerId: current });

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
    expect(
      after.value === "picking" ||
        after.value === "diary" ||
        after.value === "end",
    ).toBeTruthy();
  });
});
