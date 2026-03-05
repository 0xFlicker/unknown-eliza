import { describe, it, expect } from "bun:test";
import { stringToUuid, UUID } from "@elizaos/core";
import { createActor } from "xstate";
import { createPhaseMachine } from "@/plugins/house/game/phase";
import {
  createPlayerPhaseActor,
  PlayerPhaseEvent,
} from "@/plugins/influencer/game/phase";
import { GameSettings, Phase } from "@/plugins/house/game/types";

/**
 * Generate a messageId for testing (external generation)
 */
function generateMessageId(prefix: string, index: number): UUID {
  return stringToUuid(`${prefix}-${index}`);
}

/**
 * Create a test house phase machine
 */
function createTestHouseMachine(
  players: UUID[],
  settings: Partial<GameSettings["timers"]> = {},
) {
  const gameSettings: GameSettings = {
    timers: {
      whisper: 360000,
      whisper_pick: 10000,
      whisper_room: 10000,
      diary: 10000,
      diary_response: 10000,
      diary_ready: 10000,
      diary_prompt: 10000,
      round: 10000,
      ...settings,
    },
  };

  const phaseMachine = createPhaseMachine(gameSettings);
  return createActor(phaseMachine, {
    input: {
      gameId: stringToUuid("game-123"),
      playerSettings: players.map((p) => ({
        agentId: p,
        diaryRoomId: stringToUuid(p + "-diary1"),
      })),
      maxPlayers: 8,
      minPlayers: 2,
    },
  }).start();
}

/**
 * Create a test player phase machine
 */
function createTestPlayerMachine(
  playerId: UUID,
  name: string,
  timeouts: { roundTimeoutMs: number; diaryTimeoutMs: number } = {
    roundTimeoutMs: 60000,
    diaryTimeoutMs: 30000,
  },
) {
  return createPlayerPhaseActor(
    {
      self: { id: playerId, name },
    },
    timeouts,
  );
}

describe("Introduction Phase End-to-End State Machine Test", () => {
  it("walks house and players through introductions and diary readiness", () => {
    const playerIds = [
      stringToUuid("player-1"),
      stringToUuid("player-2"),
      stringToUuid("player-3"),
    ];
    const playerNames = ["Alpha", "Beta", "Gamma"];
    const introRoomId = stringToUuid("intro-room");
    const houseActor = createTestHouseMachine(playerIds);

    const playerActors = new Map<
      UUID,
      ReturnType<typeof createPlayerPhaseActor>
    >();
    for (let i = 0; i < playerIds.length; i++) {
      const actor = createTestPlayerMachine(playerIds[i], playerNames[i], {
        roundTimeoutMs: 60000,
        diaryTimeoutMs: 30000,
      });
      actor.start();
      playerActors.set(playerIds[i], actor);
    }

    const broadcastToPlayers = (event: PlayerPhaseEvent) => {
      for (const actor of playerActors.values()) {
        actor.send(event);
      }
    };

    const houseAgentId = stringToUuid("house-agent");
    for (const playerId of playerIds) {
      houseActor.send({ type: "GAME:PLAYER_READY", playerId });
    }
    houseActor.send({
      type: "GAME:CREATE_ROOM",
      roomId: introRoomId,
      ownerId: houseAgentId,
      participantIds: playerIds,
    });

    let houseState = houseActor.getSnapshot();
    expect(houseState.value).toEqual({ introduction: "waiting" });

    broadcastToPlayers({
      type: "GAME:PHASE_ENTERED",
      phase: Phase.INTRODUCTION,
      roomId: introRoomId,
    });
    for (const actor of playerActors.values()) {
      expect(actor.getSnapshot().value).toEqual({ introduction: "collecting" });
    }

    let introMessageIndex = 0;
    for (const playerId of playerIds) {
      const messageEvent = {
        type: "GAME:MESSAGE_SENT" as const,
        roomId: introRoomId,
        playerId,
        messageId: generateMessageId("intro", introMessageIndex++),
      };
      houseActor.send(messageEvent);
      broadcastToPlayers(messageEvent);
    }

    houseState = houseActor.getSnapshot();
    expect(houseState.value).toEqual({ introduction: "strategy" });
    const diaryChild =
      houseActor.getSnapshot().children?.["introduction-diary"];
    expect(diaryChild?.getSnapshot().value).toBe("prompting");

    const diaryRooms = houseActor.getSnapshot().context.diaryRooms;
    let diaryPromptIndex = 0;
    for (const playerId of playerIds) {
      const diaryRoomId = diaryRooms[playerId];
      const promptEvent = {
        type: "GAME:DIARY_PROMPT" as const,
        playerId,
        roomId: diaryRoomId,
        messageId: generateMessageId("diary-prompt", diaryPromptIndex),
      };
      houseActor.send(promptEvent);
      playerActors.get(playerId)?.send({
        type: "GAME:DIARY_PROMPT",
        roomId: diaryRoomId,
        messageId: promptEvent.messageId,
      });

      const responseEvent = {
        type: "GAME:DIARY_RESPONSE" as const,
        playerId,
        roomId: diaryRoomId,
        messageId: generateMessageId("diary-response", diaryPromptIndex),
      };
      diaryPromptIndex += 1;
      houseActor.send(responseEvent);
      playerActors.get(playerId)?.send(responseEvent);

      playerActors.get(playerId)?.send({ type: "GAME:ARE_YOU_READY" });
      playerActors.get(playerId)?.send({ type: "GAME:PLAYER_READY", playerId });
      houseActor.send({ type: "GAME:PLAYER_READY", playerId });
    }

    const diarySnapshot = diaryChild?.getSnapshot();
    expect(diarySnapshot?.value).toBe("finalize");
    const finalHouseState = houseActor.getSnapshot();
    expect(finalHouseState.value).toEqual("lobby_wait");

    for (const actor of playerActors.values()) {
      expect(actor.getSnapshot().value).toBe("complete");
    }
  });
});
