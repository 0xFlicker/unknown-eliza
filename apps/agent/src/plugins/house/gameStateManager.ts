import { IAgentRuntime, UUID, createUniqueUuid } from "@elizaos/core";
import { createPhaseActor, createPhaseMachine, PhaseInput } from "@/game/phase";
import { getGameState } from "@/memory/runtime";
import { GameSettings } from "@/game/types";
import internalMessageBus, { gameEvent$ } from "../coordinator/bus";
import { CoordinationService } from "../coordinator/service";
import { Service } from "@elizaos/core";

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

  capabilityDescription = "Manages the game state for the house";
  static serviceType = "game-state-manager";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.phases = new Map();
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
        console.log(`🏠 House received game event: ${event.type}`);
        phaseActor.send(event.payload.action as any);
      });

      phaseActor.on("*", (event) => {
        const broadcastable = new Set([
          "ARE_YOU_READY",
          "ALL_PLAYERS_READY",
          "PLAYER_READY_ERROR",
        ]);
        if (!broadcastable.has((event as any).type)) {
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
        } as any;
        svc?.sendGameEvent(payload);
        if ((event as any).type === "ALL_PLAYERS_READY") {
          setTimeout(() => {
            svc?.sendGameEvent(payload);
          }, 5000);
        }
      });
    }

    return gameState;
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
