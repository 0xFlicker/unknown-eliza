import { AgentRuntime, ChannelType, IAgentRuntime, UUID } from "@elizaos/core";
import { createPhaseActor, createPhaseMachine, PhaseInput } from "@/game/phase";
import { getGameState } from "@/memory/runtime";
import { GameSettings, Phase } from "@/game/types";
import { gameAction$ } from "../coordinator/bus";
import { CoordinationService } from "../coordinator/service";
import { Service } from "@elizaos/core";
import { InfluenceApp, ParticipantMode, ParticipantState } from "@/server";

type RoomType = "introduction" | "lobby" | "whisper" | "diary";

/**
 * High-level abstraction for managing game state changes and triggering
 * the appropriate events through the PhaseCoordinator system.
 *
 * This ensures all state transitions follow the proper game rules with
 * timeouts, player coordination, and event emission.
 */
export class GameStateManager extends Service {
  // Map of gameID (worldId externally) to phaseActor
  private influenceApp?: InfluenceApp<any, any, IAgentRuntime>;
  private phaseActor?: ReturnType<typeof createPhaseActor>;
  private gameId?: UUID;

  public getGameId() {
    return this.gameId;
  }
  private diaryRoomPerPlayer: Map<UUID, UUID> = new Map();
  private whisperRoomPerPlayer: Map<UUID, UUID> = new Map();
  private introductionRoomId?: UUID;

  public getIntroductionRoomId() {
    if (!this.introductionRoomId) {
      throw new Error("Introduction room not initialized");
    }
    return this.introductionRoomId;
  }
  private lobbyRoomId?: UUID;

  capabilityDescription = "Manages the game state for the house";
  static serviceType = "game-state-manager";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  async initializeGame(
    influenceApp: InfluenceApp<any, any, any>,
    players: UUID[],
  ) {
    const app = (this.influenceApp = influenceApp);
    const minPlayers = Number(
      this.runtime.getSetting("HOUSE_MIN_PLAYERS") || 3,
    );
    const maxPlayers = Number(
      this.runtime.getSetting("HOUSE_MAX_PLAYERS") || 8,
    );
    if (players.length < minPlayers || players.length > maxPlayers) {
      throw new Error(
        `Cannot initialize game: player count ${players.length} is out of bounds (${minPlayers}-${maxPlayers})`,
      );
    }
    console.log(
      `🏠 Initializing game with settings (minPlayers: ${minPlayers}, maxPlayers: ${maxPlayers})`,
    );
    const gameId = (this.gameId = await app.createGame({
      players,
      settings: {
        minPlayers,
        maxPlayers,
      },
      initialPhase: Phase.INIT,
    }));
    this.introductionRoomId = await app.createGameChannel(gameId, {
      name: "Introduction Room",
      participants: players.map((p) => ({
        agentId: p,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      })),
      type: ChannelType.GROUP,
    });
    this.lobbyRoomId = await app.createGameChannel(gameId, {
      name: "Lobby Room",
      participants: players.map((p) => ({
        agentId: p,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      })),
      type: ChannelType.GROUP,
    });
    this.phaseActor = app.getGame(gameId)?.phase!;
  }

  async initializePhase(
    roomId: UUID,
    gameSettings: GameSettings,
    phaseInput: PhaseInput,
  ) {
    let gameState = await getGameState(this.runtime, roomId);
    // Avoid re-initializing if we already created the actor for this gameId
    // if (!this.phases.has(gameSettings.id)) {
    //   const phaseActor = createPhaseActor(
    //     createPhaseMachine(gameSettings),
    //     phaseInput
    //   );
    //   phaseActor.start();
    //   gameState = {
    //     id: gameSettings.id,
    //     gameSettings,
    //     phaseInput,
    //     phaseSnapshot: phaseActor.getPersistedSnapshot(),
    //   };
    //   this.phases.set(gameSettings.id, phaseActor);

    //   gameAction$.subscribe((event) => {
    //     // Only send events to phase actors "emitted" will be events from the phase machine
    //     if (!("event" in event.payload)) {
    //       return;
    //     }

    //     console.log(`🏠 House received game event: ${event.type}`);
    //     phaseActor.send(event.payload.event);
    //   });

    // phaseActor.on("*", (event) => {
    //   const coordSvc = this.runtime.getService<CoordinationService>(
    //     CoordinationService.serviceType
    //   );

    //   coordSvc?.emitGameEvent({
    //     emitted: event,
    //     type: `GAME:${event.type}` as const,
    //     gameId: roomId,
    //     roomId: roomId,
    //     runtime: this.runtime,
    //     source: "house",
    //     timestamp: Date.now(),
    //   } as any); // TODO fix any
    // });

    //   // phaseActor.on("*", (event) => {
    //   //   const broadcastable = new Set([
    //   //     "ARE_YOU_READY",
    //   //     "ALL_PLAYERS_READY",
    //   //     "PLAYER_READY_ERROR",
    //   //   ]);
    //   //   if (!broadcastable.has(event.type)) {
    //   //     return;
    //   //   }
    //   //   const svc = this.runtime.getService<CoordinationService>(
    //   //     CoordinationService.serviceType,
    //   //   );
    //   //   const payload: any = {
    //   //     gameId: gameSettings.id,
    //   //     roomId,
    //   //     runtime: this.runtime,
    //   //     source: "house",
    //   //     timestamp: Date.now(),
    //   //     action: event,
    //   //   };
    //   //   svc?.sendGameEvent(payload);
    //   // });
    // }

    return gameState;
  }

  async addPlayer(gameId: UUID, playerId: UUID) {
    if (this.phaseActor) {
      this.phaseActor.send({ type: "GAME:ADD_PLAYER", playerId });
    }
  }

  async stop() {
    this.phaseActor?.stop();
  }

  static async start(runtime: IAgentRuntime) {
    const svc = new GameStateManager(runtime);
    return svc;
  }
}
