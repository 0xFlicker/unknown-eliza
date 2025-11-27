import {
  UUID,
  IAgentRuntime,
  ChannelType,
  stringToUuid,
  createUniqueUuid,
  logger,
} from "@elizaos/core";
import { HousePluginConfig } from "../plugins/house";
import { Phase } from "@/plugins/house/game/types";
import { GameStatePreloader } from "../__tests__/utils/game-state-preloader";
import { ChannelManager } from "./channel-manager";
import { AgentManager } from "./agent-manager";
import { ChannelConfig, ParticipantMode, ParticipantState } from "./types";
import {
  createPhaseActor,
  createPhaseMachine,
  PhaseInput,
  PhaseEmitted,
} from "@/plugins/house/game/phase";
import { GameSettings } from "@/plugins/house/game/types";
import { getCapacityTracker } from "@elizaos/server";
import { gameAction$ } from "@/plugins/coordinator/bus";
import { CoordinationService } from "@/plugins/coordinator";
import { GameStateManager } from "@/plugins/house/gameStateManager";
import "@/plugins/coordinator/bus"; // Ensure bus is initialized

/**
 * Game configuration for creating a new game
 */
export interface GameConfig {
  players: UUID[];
  settings?: Partial<HousePluginConfig>;
  initialPhase?: Phase;
  name?: string;
}

/**
 * Represents an active game session
 */
export interface GameSession {
  id: UUID;
  name: string;
  players: UUID[];
  settings: HousePluginConfig;
  channels: Set<UUID>;
  createdAt: number;
  phaseInput: PhaseInput;
  phaseSettings: GameSettings;
  phase: ReturnType<typeof createPhaseActor>;
}

/**
 * Whisper settings used to configure the whisper phase.
 */
export interface WhisperSettings {
  maxWhisperRequests: number;
  maxMessagesPerPlayerPerRoom: number;
  whisperRoomTimeoutMs: number;
  perRoomMaxParticipants?: number;
}

/**
 * GameManager handles game lifecycle and channel creation with proper game context.
 * It owns the GameStatePreloader to inject game state into agents when they enter game channels.
 */
export class GameManager<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private games = new Map<UUID, GameSession>();
  private gamesByChannel = new Map<UUID, UUID>(); // channelId -> gameId mapping
  private lobbyEndedChannels = new Set<UUID>();

  constructor(
    private agentManager: AgentManager<Context, Runtime>,
    private channelManager: ChannelManager<Context, Runtime>,
    private houseAgent: IAgentRuntime,
    private messageServerId: string,
  ) {}

  /**
   * Create a whisper room for a game. House will call this to create ephemeral channels.
   * Implementation: stub — should create a channel, add runtime decorator to inject game state, and register room.
   */
  async createWhisperRoom(
    gameId: UUID,
    ownerId: UUID,
    participantIds: UUID[],
    channelConfig?: Omit<ChannelConfig, "runtimeDecorators">,
  ): Promise<UUID> {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);
    // TODO: validate remaining requests, participant eligibility, and decrement counters
    const cfg: ChannelConfig = {
      name: channelConfig?.name || `whisper-${gameId}-${Date.now()}`,
      participants: [ownerId, ...participantIds].map((id) => ({
        agentId: id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      })),
      type: ChannelType.GROUP,
      metadata: channelConfig?.metadata,
      maxMessages: channelConfig?.maxMessages,
      timeoutMs: channelConfig?.timeoutMs,
    } as ChannelConfig;

    const channelId = await this.channelManager.createChannel(cfg);

    return channelId;
  }

  /**
   * End a whisper room and clean up state. Stub implementation: destroy channel and remove from activeRooms.
   */
  async endWhisperRoom(gameId: UUID, roomId: UUID, reason?: string) {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);
    await this.channelManager.removeChannel(roomId);
  }

  /**
   * Create a new game session with the specified configuration
   */
  async createGame(config: GameConfig): Promise<UUID> {
    const { players, settings = {}, initialPhase = Phase.INIT, name } = config;

    // Create unique gameId
    const gameId = stringToUuid(
      `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );

    const phaseInput: PhaseInput = {
      players,
      maxPlayers: config.settings?.maxPlayers || 8,
      minPlayers: config.settings?.minPlayers || 4,
    };

    const phaseSettings = {
      id: gameId,
      timers: {
        diary: config.settings?.phaseTimeouts?.diary || 10000,
        round: config.settings?.phaseTimeouts?.round || 10000,
        whisper: config.settings?.phaseTimeouts?.whisper || 360000,
        whisper_pick: config.settings?.phaseTimeouts?.whisperPick || 10000,
        whisper_room: config.settings?.phaseTimeouts?.whisperRoom || 10000,
      },
    };

    const phase = createPhaseActor(
      createPhaseMachine({
        id: gameId,
        timers: phaseSettings.timers,
      }),
      phaseInput,
    );

    // Create game session
    const gameSession: GameSession = {
      id: gameId,
      name: name || `Game ${gameId.substring(0, 8)}`,
      players,
      settings: {
        minPlayers: config.settings?.minPlayers || 4,
        maxPlayers: config.settings?.maxPlayers || 8,
        autoStartGame: true,
        ...settings,
      },
      channels: new Set(),
      createdAt: Date.now(),
      phaseInput,
      phaseSettings,
      phase,
    };

    // Store game session
    this.games.set(gameId, gameSession);
    const gameStateManager = this.houseAgent.getService<GameStateManager>(
      GameStateManager.serviceType,
    );

    if (!gameStateManager) {
      throw new Error("GameStateManager service not found in House agent");
    }

    this.subscribeToGameEvents(gameId, this.houseAgent);
    gameAction$.subscribe((event) => {
      console.log(`🏠 House received game event: ${event.type}`);
      // Only send events to phase actors "emitted" will be events from the phase machine
      if (!("event" in event.payload)) {
        console.warn(`🏠 Ignoring non-event payload: ${event.type}`);
        return;
      }

      console.log(`🏠 House received game event: ${event.type}`);
      phase.send(event.payload.event);
    });

    logger.info(
      `Created game ${gameId} with ${players.length} players in phase ${initialPhase}`,
    );

    return gameId;
  }

  async subscribeToGameEvents(gameId: UUID, runtime: IAgentRuntime) {
    const gameSession = this.games.get(gameId);
    if (!gameSession) {
      throw new Error(`Game ${gameId} not found`);
    }

    const phaseActor = gameSession.phase;

    console.log(`🏠 Subscribing to game events for game ${gameId}`);
    phaseActor.on("*", (event) => {
      console.log(`🏠 Received emittable event: ${event.type}`);
      const coordSvc = runtime.getService<CoordinationService>(
        CoordinationService.serviceType,
      );

      if (!coordSvc) {
        console.warn("CoordinationService not found in runtime");
        throw new Error("CoordinationService not found in runtime");
      }

      coordSvc.emitGameEvent<typeof event.type>({
        emitted: event,
        type: event.type,
        gameId,
        roomId: "roomId" in event ? event.roomId : undefined,
        runtime: runtime,
        source: "house",
        timestamp: Date.now(),
      } as any); // TODO fix any but idk how
    });

    return phaseActor;
  }

  /**
   * Create a channel for a specific game with game state pre-loaded
   */
  async createGameChannel(
    gameId: UUID,
    channelConfig: Omit<ChannelConfig, "runtimeDecorators">,
  ): Promise<UUID> {
    const gameSession = this.games.get(gameId);
    if (!gameSession) {
      throw new Error(`Game ${gameId} not found`);
    }

    // Create channel with game state injection decorator
    const channelId = await this.channelManager.createChannel({
      ...channelConfig,
      runtimeDecorators: [
        async (runtime, context) => {
          if (!context?.channelId) {
            throw new Error("Channel ID is required");
          }
          // Inject game state into this agent's runtime for this channel
          await this.injectGameStateIntoAgent(
            runtime,
            gameId,
            context.channelId,
          );
          return runtime;
        },
      ],
    });

    // Associate this channel with the game
    gameSession.channels.add(channelId);
    this.gamesByChannel.set(channelId, gameId);

    logger.info(
      `Created channel ${channelId} for game ${gameId} (${gameSession.name})`,
    );

    return channelId;
  }

  /**
   * Handle a new message on a channel. If the channel is a LOBBY channel with per-participant
   * capacity limits, and all players have exhausted their budgets, end the round and open diary DMs.
   */
  async handleChannelMessage(channelId: UUID): Promise<void> {
    const gameId = this.gamesByChannel.get(channelId);
    if (!gameId) return;
    const game = this.games.get(gameId);
    if (!game) return;

    const state = game.phase.getSnapshot();
    if (state.value !== "lobby") return;
    if (this.lobbyEndedChannels.has(channelId)) return;

    const tracker = getCapacityTracker?.();
    if (!tracker) return;

    // Require a configured channel limit; if not configured, skip
    const allExhausted = game.players.every((pid) => {
      const info = tracker.getCapacityInfo(channelId, pid);
      return info.responsesRemaining === 0;
    });

    if (allExhausted) {
      this.lobbyEndedChannels.add(channelId);
      // End LOBBY round; the lobby room machine will trigger diary ready sequence
      game.phase.send({ type: "GAME:CHANNEL_EXHAUSTED" });

      // Proactively mute players in lobby channel to prevent further replies
      for (const pid of game.players) {
        await this.channelManager.updateParticipantState(
          channelId,
          pid,
          ParticipantState.MUTED,
        );
      }
    }
  }

  /**
   * Create DM channels between House and each player and send a diary prompt seeded with
   * recent lobby messages from other players.
   */
  public async openLobbyDiaryRooms(gameId: UUID, lobbyChannelId: UUID) {
    const game = this.games.get(gameId);
    if (!game) return;

    const nameById = new Map(
      game.players.map((pid) => {
        const rt = this.agentManager.getAgentRuntime(pid);
        return [pid, rt?.character?.name || pid] as const;
      }),
    );

    // Fetch recent lobby messages once
    const lobbyMessages = await this.channelManager.getMessages(lobbyChannelId);

    for (const pid of game.players) {
      const dmId = await this.channelManager.ensureDmChannel(pid);
      // Build recent messages from others
      const recentByOther = lobbyMessages
        .filter((m) => m.authorId !== pid)
        .slice(-6)
        .map(
          (m) =>
            `- ${nameById.get(m.authorId)!}: ${String(m.content).slice(0, 280)}`,
        )
        .join("\n");

      const playerName = nameById.get(pid) || "Player";
      const prompt = [
        `Diary Question for ${playerName}:`,
        `Reflect on the LOBBY conversations so far. Who seems aligned or deceptive?`,
        `Recent messages:`,
        recentByOther || "(no recent messages)",
      ].join("\n");

      // Send DM prompt as House
      await this.channelManager.sendHouseMessage(dmId, prompt);
    }
  }

  /**
   * Create a main game channel with all players and House agent
   */
  async createMainGameChannel(
    gameId: UUID,
    channelName?: string,
  ): Promise<UUID> {
    const gameSession = this.games.get(gameId);
    if (!gameSession) {
      throw new Error(`Game ${gameId} not found`);
    }

    const channelId = await this.createGameChannel(gameId, {
      name: channelName || `${gameSession.name} - Main Channel`,
      participants: [
        // House agent as broadcast-only moderator
        {
          agentId: this.houseAgent.agentId,
          mode: ParticipantMode.BROADCAST_ONLY,
          state: ParticipantState.FOLLOWED,
        },
        // All players as read-write participants
        ...gameSession.players.map((playerId) => ({
          agentId: playerId,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        })),
      ],
      type: ChannelType.GROUP,
    });

    logger.info(
      `Created main game channel ${channelId} for game ${gameId} with ${gameSession.players.length} players`,
    );

    return channelId;
  }

  /**
   * Get game session by ID
   */
  getGame(gameId: UUID): GameSession | undefined {
    return this.games.get(gameId);
  }

  /**
   * Get game ID by channel ID
   */
  getGameByChannel(channelId: UUID): UUID | undefined {
    return this.gamesByChannel.get(channelId);
  }

  /**
   * Get all active games
   */
  getAllGames(): GameSession[] {
    return Array.from(this.games.values());
  }

  /**
   * Remove a game and clean up all associated resources
   */
  async removeGame(gameId: UUID): Promise<void> {
    const gameSession = this.games.get(gameId);
    if (!gameSession) {
      return;
    }

    // Remove channel mappings
    for (const channelId of gameSession.channels) {
      this.gamesByChannel.delete(channelId);
    }

    // Remove game session
    this.games.delete(gameId);

    logger.info(
      `Removed game ${gameId} and cleaned up ${gameSession.channels.size} channels`,
    );
  }

  /**
   * Get game statistics
   */
  getStats() {
    return {
      totalGames: this.games.size,
      totalGameChannels: this.gamesByChannel.size,
      gamesByPhase: Array.from(this.games.values()).reduce(
        (acc, game) => {
          acc[game.phase.getSnapshot().value] =
            (acc[game.phase.getSnapshot().value] || 0) + 1;
          return acc;
        },
        {} as Record<Phase, number>,
      ),
    };
  }

  /**
   * Private method to inject game state into an agent's runtime for a specific channel
   */
  private async injectGameStateIntoAgent(
    runtime: IAgentRuntime,
    gameId: UUID,
    channelId: UUID,
  ): Promise<void> {
    const gameSession = this.games.get(gameId);
    if (!gameSession) {
      logger.warn(`Cannot inject game state: Game ${gameId} not found`);
      return;
    }

    // Get player agents for game state creation
    const playerAgents = gameSession.players.map((playerId) => {
      const playerRuntime = this.agentManager.getAgentRuntime(playerId);
      if (!playerRuntime) {
        throw new Error(
          `Player agent ${playerId} not found during state injection`,
        );
      }
      return {
        id: playerId,
        character: playerRuntime.character,
      };
    });

    // Ensure the channel room exists in this runtime
    const worldId = createUniqueUuid(runtime, this.messageServerId);
    await runtime.ensureRoomExists({
      id: channelId,
      name: `${gameSession.name} Channel`,
      source: "game-manager",
      agentId: runtime.agentId,
      type: ChannelType.GROUP,
      worldId,
    });

    // Save game state to the channel room
    await GameStatePreloader.saveGameStateToRuntime(runtime, gameId, {
      id: gameId,
      gameSettings: gameSession.phaseSettings,
      phaseInput: gameSession.phaseInput,
      phaseSnapshot: gameSession.phase.getSnapshot(),
    });

    // Store the gameId in runtime cache for easy access
    await runtime.setCache(`channel_${channelId}_gameId`, gameId);
    await runtime.setCache(`game_${gameId}_channel`, channelId);

    logger.info(
      `Injected game state for game ${gameId} into agent ${runtime.character?.name} for channel ${channelId}`,
    );
  }

  getIntroductionRoomId(gameId: UUID): UUID | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;
    const gameStateManager = this.houseAgent.getService<GameStateManager>(
      GameStateManager.serviceType,
    );
    if (!gameStateManager) {
      throw new Error("GameStateManager service not found in House agent");
    }
    return gameStateManager.getIntroductionRoomId();
  }
}
