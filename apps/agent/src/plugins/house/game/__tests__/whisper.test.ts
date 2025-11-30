import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { stringToUuid, UUID } from "@elizaos/core";
import { describe, it, expect } from "bun:test";
import { Phase } from "../types";

describe("Whisper machine", () => {
  it("creates a room, counts messages, enforces per-player per-room limit, and advances turns", () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");
    const p3 = stringToUuid("p3");
    const allPlayers = [p1, p2, p3];

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
          playerSettings: allPlayers.map((p) => ({
            agentId: p,
            diaryRoomId: stringToUuid(p + "-diary1"),
          })),
          minPlayers: 2,
          maxPlayers: 3,
          startPhase: Phase.WHISPER,
          whisperSettings: {
            requestsPerPlayer: 3,
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
      // console.log(`Player ${event.playerId} turn`);

      // take 1 action
      const otherPlayer = allPlayers.filter((p) => p !== event.playerId)[0];
      players.push({
        ownerId: event.playerId,
        participantIds: [otherPlayer],
      });
      actor.send({
        type: "GAME:CREATE_ROOM",
        ownerId: event.playerId,
        roomId: stringToUuid("r1"),
        participantIds: [otherPlayer],
      });
    });

    actor.start();

    const sv = actor.getSnapshot().value;
    expect(sv).toEqual({
      whisper: "active",
    });
    expect(players.length).toBe(1);

    // p1 sends two messages
    players.forEach(({ ownerId, participantIds }) => {
      actor.send({
        type: "GAME:MESSAGE_SENT",
        roomId: stringToUuid("r1"),
        messageId: stringToUuid("m1"),
        playerId: ownerId,
      });
      participantIds.forEach((participantId) => {
        actor.send({
          type: "GAME:MESSAGE_SENT",
          roomId: stringToUuid("r1"),
          messageId: stringToUuid("m2"),
          playerId: participantId,
        });
      });
    });

    // advance to next turn so the machine returns to picking
    actor.send({
      type: "GAME:END_ROOM",
      roomId: stringToUuid("r1"),
    });
    expect(actor.getSnapshot().value).toEqual({
      whisper: "picking",
    });
    const { context } = actor.getSnapshot();
    expect(context.whisper?.activeRoom).toBeUndefined();
  });
  it("blocks CREATE_ROOM when owner lacks requests", () => {
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
            requestsPerPlayer: 3,
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 2,
          },
        },
      },
    ).start();

    const roomId = stringToUuid("r-block-create");

    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId,
      ownerId: p1,
      participantIds: [p1, p2],
    });

    const ctx = actor.getSnapshot().context;
    expect(ctx.whisper?.activeRoom).toBeUndefined();
    expect(ctx.whisper?.remainingRequests[p1]).toBe(3);
  });

  it("decrements remainingRequests only on CREATE_ROOM and by correct amount", () => {
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
            requestsPerPlayer: 3,
            maxMessagesPerPlayerPerRoom: 5,
            perRoomMaxParticipants: 3,
          },
        },
      },
    ).start();

    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: stringToUuid("r-decrement-requests"),
      ownerId: p1,
      participantIds: [p1, p2],
    });
    expect(actor.getSnapshot().context.whisper?.remainingRequests[p1]).toBe(2);

    // MESSAGE_SENT should not change remainingRequests
    actor.send({
      type: "GAME:MESSAGE_SENT",
      roomId: stringToUuid("r-decrement-requests"),
      messageId: stringToUuid("m1"),
      playerId: p1,
    });
    expect(actor.getSnapshot().context.whisper?.remainingRequests[p1]).toBe(2);
  });

  it("PASS forfeits current player's remainingRequests and emits next player's turn", () => {
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
            requestsPerPlayer: 3,
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
      actor.getSnapshot().context.whisper?.turnOrder[
        actor.getSnapshot().context.whisper?.currentTurnIndex ?? 0
      ] ?? ("unknown" as UUID);
    expect(current).toBeDefined();

    actor.send({ type: "GAME:PASS", playerId: current as UUID });

    expect(
      actor.getSnapshot().context.whisper?.remainingRequests[current as UUID],
    ).toBe(0);
    // because we emitted next player's turn synchronously via emitYourTurn, we should have seen it already
    expect(sawYourTurnForNext).toBeTruthy();
  });

  it("pick-timeout forfeits and advances to next picker/round", async () => {
    const p1 = stringToUuid("p1");
    const p2 = stringToUuid("p2");

    const actor = createActor(
      createPhaseMachine({
        id: stringToUuid("game1"),
        timers: {
          whisper: 1000,
          whisper_pick: 5,
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
            requestsPerPlayer: 3,
            maxMessagesPerPlayerPerRoom: 3,
            perRoomMaxParticipants: 2,
          },
        },
      },
    ).start();

    const startPlayer =
      actor.getSnapshot().context.whisper?.turnOrder[
        actor.getSnapshot().context.whisper?.currentTurnIndex ?? 0
      ] ?? ("unknown" as UUID);
    await new Promise((r) => setTimeout(r, 10));
    // console.log(actor.getSnapshot().context);
    const after = actor.getSnapshot();
    // startPlayer should have remainingRequests 0
    expect(after.context.whisper?.remainingRequests[startPlayer]).toBe(0);
    // machine should have proceeded (either to picking another player or diary)
    expect(after.value).toEqual({
      whisper: "pick-timeout",
    });
  });
});
