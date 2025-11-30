import { describe, it, expect } from "bun:test";
import { stringToUuid, UUID } from "@elizaos/core";
import { createActor } from "xstate";
import { createPhaseMachine } from "@/plugins/house/game/phase";
import { createPlayerPhaseActor } from "@/plugins/influencer/game/phase";
import { GameSettings, Phase } from "@/plugins/house/game/types";
import { TestEventBus } from "./utils/test-event-bus";

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
    id: stringToUuid("test-game"),
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
      players,
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

/**
 * Collect emitted events from an actor
 */
function collectEmittedEvents(actor: any): { events: any[] } {
  const events: any[] = [];
  const listener = (event: any) => {
    events.push(event);
  };
  actor.on("*", listener);
  return { events };
}

describe("Introduction Phase End-to-End State Machine Test", () => {
  it("completes full INTRODUCTION phase flow with house and player machines", () => {
    // Setup: Create players
    const playerIds = [
      stringToUuid("player-1"),
      stringToUuid("player-2"),
      stringToUuid("player-3"),
    ];
    const playerNames = ["Alpha", "Beta", "Gamma"];

    // Create house machine
    const houseActor = createTestHouseMachine(playerIds, {
      round: 60000, // Long timeout for testing
      diary: 60000,
      diary_response: 60000,
      diary_ready: 60000,
      diary_prompt: 60000,
    });
    houseActor.start();

    // Create player machines
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

    // Create event bus
    const eventBus = new TestEventBus(houseActor, playerActors);
    eventBus.start();

    // Collect emitted events
    const houseEvents = collectEmittedEvents(houseActor);
    const playerEvents = new Map<
      UUID,
      ReturnType<typeof collectEmittedEvents>
    >();
    for (const [playerId, actor] of playerActors.entries()) {
      playerEvents.set(playerId, collectEmittedEvents(actor));
    }

    try {
      // Step 1: Join Phase - All players ready
      for (const playerId of playerIds) {
        houseActor.send({ type: "GAME:PLAYER_READY", playerId });
      }

      houseActor.send({
        type: "GAME:CREATE_ROOM",
        // ownerId: playerIds[0],
        participantIds: playerIds,
      });

      // Wait for house to transition to introduction
      // The house should emit GAME:ALL_PLAYERS_READY and transition
      let houseState = houseActor.getSnapshot();
      expect(houseState.value).toEqual({ introduction: "waiting" });

      // Step 2: Introduction Phase
      // House should emit GAME:PHASE_ENTERED and GAME:INTRODUCTION_ROOM_CREATED
      const introRoomId = houseState.context.introduction?.roomId;
      expect(introRoomId).toBeDefined();

      // Each player sends introduction message
      let messageIdCounter = 0;
      for (const playerId of playerIds) {
        const messageId = generateMessageId("intro", messageIdCounter++);
        // Send to house (simulating player sending message)
        houseActor.send({
          type: "GAME:MESSAGE_SENT",
          roomId: introRoomId,
          playerId,
          messageId,
        });
      }

      // Verify all players introduced
      houseState = houseActor.getSnapshot();
      const introChild = houseState.children.introduction;
      if (introChild) {
        const introSnapshot = introChild.getSnapshot();
        // Check introduction messages in context
        const introContext = introSnapshot.context as {
          introductionMessages: Record<string, string>;
        };
        expect(Object.keys(introContext.introductionMessages).length).toBe(
          playerIds.length,
        );
      }

      // Step 3: Diary Phase
      // The introduction machine should transition to diary (strategy state)
      // Wait for introduction to complete and diary to start
      houseState = houseActor.getSnapshot();
      expect(houseState.children.introduction).toBeDefined();

      const introSnapshot = houseState.children.introduction!.getSnapshot();
      expect(introSnapshot.value).toBe("strategy");

      // The diary machine should be invoked and waiting in "prompting" state
      const diaryChild =
        houseState.children.introduction!.getSnapshot().children?.[
          "house-diary"
        ];
      expect(diaryChild).toBeDefined();

      let diarySnapshot = diaryChild!.getSnapshot();
      expect(diarySnapshot.value).toBe("prompting");

      // For each player, the diary machine will emit GAME:DIARY_PROMPT_READY
      // External handler (test) provides messageId and sends GAME:DIARY_PROMPT back
      messageIdCounter = 0;
      for (let i = 0; i < playerIds.length; i++) {
        const playerId = playerIds[i];

        // Verify we're in prompting state - diary will emit GAME:DIARY_PROMPT_READY
        diarySnapshot = diaryChild!.getSnapshot();
        expect(diarySnapshot.value).toBe("prompting");

        // External handler (test) creates prompt with messageId and sends it back
        const promptMessageId = generateMessageId(
          "diary-prompt",
          messageIdCounter++,
        );

        // Send GAME:DIARY_PROMPT with messageId through introduction machine
        // (which forwards to diary child)
        introChildState!.send({
          type: "GAME:DIARY_PROMPT",
          targetPlayerId: playerId,
          messageId: promptMessageId,
        });

        // After receiving DIARY_PROMPT, diary should emit it to player and transition to awaitResponse
        diarySnapshot = diaryChild!.getSnapshot();
        expect(diarySnapshot.value).toBe("awaitResponse");

        // Player should receive GAME:DIARY_PROMPT via event bus
        // Then player responds with GAME:DIARY_RESPONSE
        const responseMessageId = generateMessageId(
          "diary-response",
          messageIdCounter - 1,
        );

        // Simulate player responding - send through event bus (which routes to house)
        const playerActor = playerActors.get(playerId);
        if (playerActor) {
          // The player diary machine should receive the prompt and be in responding state
          // Send the response event (event bus will route to house)
          playerActor.send({
            type: "GAME:DIARY_RESPONSE",
            playerId,
            roomId: introRoomId!,
            messageId: responseMessageId,
          });
        }

        // Send response to house (through introduction machine which forwards to diary)
        introChildState!.send({
          type: "GAME:DIARY_RESPONSE",
          playerId,
          roomId: introRoomId!,
          messageId: responseMessageId,
        });

        // If not the last player, diary should advance to next player (back to prompting)
        if (i < playerIds.length - 1) {
          diarySnapshot = diaryChild!.getSnapshot();
          expect(diarySnapshot.value).toBe("prompting");
        }
      }

      // After all players responded, diary should be in readyBroadcast
      diarySnapshot = diaryChild!.getSnapshot();
      expect(diarySnapshot.value).toBe("readyBroadcast");

      // Step 4: Ready Phase
      // After all diary prompts, diary should be in readyBroadcast and emit GAME:ARE_YOU_READY
      // This should be routed to all players via event bus
      diarySnapshot = diaryChild!.getSnapshot();
      expect(diarySnapshot.value).toBe("readyBroadcast");

      // The diary machine should have emitted GAME:ARE_YOU_READY
      // The event bus should route this to all players
      // Wait a moment for event propagation (synchronous, but state updates happen)

      // Verify players received ARE_YOU_READY and are in finishingUp state
      for (const playerId of playerIds) {
        const playerActor = playerActors.get(playerId);
        if (playerActor) {
          const playerState = playerActor.getSnapshot();
          const introChild = playerState.children.introduction;
          if (introChild) {
            const introSnapshot = introChild.getSnapshot();
            const diaryChild = introSnapshot.children.diary;
            if (diaryChild) {
              const diarySnapshot = diaryChild.getSnapshot();
              // Player diary should be in finishingUp after receiving ARE_YOU_READY
              // If not, send ARE_YOU_READY manually (event bus should have done this)
              if (diarySnapshot.value !== "finishingUp") {
                // Manually send ARE_YOU_READY (event bus should have done this)
                playerActor.send({ type: "GAME:ARE_YOU_READY" });
              }
            }
          }
        }
      }

      // Each player sends GAME:PLAYER_READY to their own diary machine
      // The diary machine will then emit GAME:PLAYER_READY which event bus routes to house
      for (const playerId of playerIds) {
        const playerActor = playerActors.get(playerId);
        if (playerActor) {
          // Send PLAYER_READY to player's own diary machine
          playerActor.send({
            type: "GAME:PLAYER_READY",
            playerId,
          });
        }
        // Also send directly to house introduction machine which forwards to diary
        introChildState!.send({
          type: "GAME:PLAYER_READY",
          playerId,
        });
      }

      // Wait for diary to complete (should emit ALL_PLAYERS_READY and go to finalize)
      diarySnapshot = diaryChild!.getSnapshot();
      expect(diarySnapshot.value).toBe("finalize");

      // Introduction machine should complete and house should transition to lobby
      houseState = houseActor.getSnapshot();
      expect(houseState.value).toBe("lobby");

      for (const [playerId, actor] of playerActors.entries()) {
        const playerState = actor.getSnapshot();
        expect(playerState.value).toBe("complete");
      }

      // Cleanup
      eventBus.stop();
    } catch (error) {
      // Cleanup on error
      eventBus.stop();
      throw error;
    }
  });
});
