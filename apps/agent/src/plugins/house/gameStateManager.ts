import { IAgentRuntime, UUID, createUniqueUuid } from "@elizaos/core";
import { createPhaseActor, createPhaseMachine, PhaseInput } from "@/game/phase";
import { getGameState } from "@/memory/runtime";
import { GameSettings } from "@/game/types";
import internalMessageBus, { gameEvent$ } from "../coordinator/bus";
import { CoordinationService } from "../coordinator/service";
import {
  WhisperPhaseStartedPayload,
  WhisperYourTurnPayload,
} from "../coordinator/types";
import { Service } from "@elizaos/core";
import { filter } from "rxjs";

/**
 * High-level abstraction for managing game state changes and triggering
 * the appropriate events through the PhaseCoordinator system.
 *
 * This ensures all state transitions follow the proper game rules with
 * timeouts, player coordination, and event emission.
 */
export class GameStateManager extends Service {
  // Map of gameID (worldId externally) to phaseActor
  private phases: Map<UUID, ReturnType<typeof createPhaseActor>>;
  // Whisper phase state per game
  private whispers: Map<
    UUID,
    {
      settings: Partial<{
        maxWhisperRequests: number;
        maxMessagesPerPlayerPerRoom: number;
        whisperRoomTimeoutMs: number;
        perRoomMaxParticipants?: number;
      }>;
      remainingRequests: Map<UUID, number>;
      turnOrder: UUID[];
      currentTurnIndex: number;
    }
  >;

  capabilityDescription = "Manages the game state for the house";
  static serviceType = "game-state-manager";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.phases = new Map();
    this.whispers = new Map();
  }

  async initializePhase(
    roomId: UUID,
    gameSettings: GameSettings,
    phaseInput: PhaseInput,
  ) {
    console.log("🏠 Initializing phase", roomId, gameSettings, phaseInput);
    let gameState = await getGameState(this.runtime, roomId);
    // Avoid re-initializing if we already created the actor for this gameId
    if (!this.phases.has(gameSettings.id)) {
      const phaseActor = createPhaseActor(
        createPhaseMachine(gameSettings),
        phaseInput,
      );
      phaseActor.start();
      gameState = {
        id: gameSettings.id,
        gameSettings,
        phaseInput,
        phaseSnapshot: phaseActor.getPersistedSnapshot(),
      };
      this.phases.set(gameSettings.id, phaseActor);

      gameEvent$.subscribe((event) => {
        // Only send events to phase actors "emitted" will be events from the phase machine
        if (!("event" in event.payload)) {
          return;
        }

        console.log(`🏠 House received game event: ${event.type}`);
        phaseActor.send(event.payload.event);
      });

      phaseActor.on("*", (event) => {
        const broadcastable = new Set([
          "ARE_YOU_READY",
          "ALL_PLAYERS_READY",
          "PLAYER_READY_ERROR",
        ]);
        if (!broadcastable.has(event.type)) {
          return;
        }
        const svc = this.runtime.getService<CoordinationService>(
          CoordinationService.serviceType,
        );
        const payload: any = {
          gameId: gameSettings.id,
          roomId,
          runtime: this.runtime,
          source: "house",
          timestamp: Date.now(),
          action: event,
        };
        svc?.sendGameEvent(payload);
      });
    }

    return gameState;
  }

  /**
   * Initialize the whisper phase state for the given room/game and notify the first player.
   */
  async startWhisperPhase(
    gameId: UUID,
    settings: Partial<{
      maxWhisperRequests: number;
      maxMessagesPerPlayerPerRoom: number;
      whisperRoomTimeoutMs: number;
      perRoomMaxParticipants?: number;
    }> = {},
  ) {
    // Retrieve canonical game state to get player list
    const roomId = gameId;
    const gameState = await getGameState(this.runtime, roomId);
    const players = (gameState?.phaseInput?.players as UUID[]) || [];

    const whisperSettings = {
      maxWhisperRequests: settings.maxWhisperRequests ?? 1,
      maxMessagesPerPlayerPerRoom: settings.maxMessagesPerPlayerPerRoom ?? 3,
      whisperRoomTimeoutMs: settings.whisperRoomTimeoutMs ?? 60000,
      perRoomMaxParticipants: settings.perRoomMaxParticipants ?? 4,
    };

    // Build initial turn order by shuffling player ids
    const turnOrder = [...players];
    for (let i = turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
    }

    const remainingRequests = new Map<UUID, number>();
    for (const p of players) {
      remainingRequests.set(p, whisperSettings.maxWhisperRequests);
    }

    this.whispers.set(gameId, {
      settings: whisperSettings,
      remainingRequests,
      turnOrder,
      currentTurnIndex: 0,
    });

    // Notify all that whisper phase started, then notify the first player of their turn
    const svc = this.runtime.getService<CoordinationService>(
      CoordinationService.serviceType,
    );
    if (!svc) throw new Error("CoordinationService not available");

    // Broadcast phase start to all agents in the game
    const phaseStartedPayload: WhisperPhaseStartedPayload = {
      gameId,
      roomId,
      runtime: this.runtime,
      source: "house",
      timestamp: Date.now(),
      type: "GAME:WHISPER_PHASE_STARTED",
      event: { type: "WHISPER_PHASE_STARTED" },
    };

    await svc.sendGameEvent(phaseStartedPayload, "all");

    // Notify the first player privately that it's their turn once implemented in state machine
  }

  async addPlayer(gameId: UUID, playerId: UUID) {
    const phaseActor = this.phases.get(gameId);
    if (phaseActor) {
      phaseActor.send({ type: "ADD_PLAYER", playerId });
    }
  }

  async stop() {
    this.phases.forEach((phase) => {
      phase.stop();
    });
  }

  static async start(runtime: IAgentRuntime) {
    const svc = new GameStateManager(runtime);
    return svc;
  }
}
