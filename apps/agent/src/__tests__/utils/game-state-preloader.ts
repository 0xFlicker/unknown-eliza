import { IAgentRuntime, stringToUuid, UUID } from "@elizaos/core";
import { saveGameState } from "../../plugins/house/runtime/memory";
import {
  GameState,
  Player,
  PlayerStatus,
  Phase,
  DEFAULT_GAME_SETTINGS,
  GameSettings,
} from "../../plugins/house/types";
import { Agent } from "../../server/types";

/**
 * Utility for pre-loading game state in tests to skip the initialization phases
 * and jump directly to testing specific game phases.
 */
export class GameStatePreloader<Context extends Record<string, unknown>> {
  /**
   * Creates a pre-populated game state with specified players
   */
  static createGameState<Context extends Record<string, unknown>>(options: {
    playerAgents: Agent<Context>[];
    houseRuntime: IAgentRuntime; // Optional runtime for saving state
    phase: Phase;
    round?: number;
    settings?: Omit<Partial<GameSettings>, "timers"> & {
      timers?: Partial<GameSettings["timers"]>;
    }; // Override default game settings
  }): GameState {
    const {
      playerAgents,
      houseRuntime,
      phase = Phase.INIT,
      round = 0,
      settings: customSettings,
    } = options;

    const players = new Map<string, Player>();
    const gameId = stringToUuid(`test-game-${Date.now()}`);

    // Create players with real agent IDs if provided
    playerAgents.forEach((agent, index) => {
      const playerId = agent.id;
      const player: Player = {
        id: playerId,
        agentId: playerId,
        name: agent.character.name,
        status: PlayerStatus.ALIVE,
        joinedAt: Date.now() - index * 1000, // Stagger join times
      };
      players.set(playerId, player);
    });

    const gameState: GameState = {
      id: gameId,
      phase,
      round,
      players,
      votes: [],
      privateRooms: new Map(),
      exposedPlayers: new Set(),
      settings: {
        ...DEFAULT_GAME_SETTINGS,
        ...customSettings,
        timers: {
          ...DEFAULT_GAME_SETTINGS.timers,
          ...customSettings?.timers,
        },
      },
      history: [],
      isActive: phase !== Phase.INIT,
      hostId: houseRuntime.agentId,
    };

    // Add join events to history
    for (const [index, player] of Array.from(players.values()).entries()) {
      gameState.history.push({
        id: stringToUuid(`join-event-${player.name}-${Date.now()}`),
        type: "PLAYER_JOINED",
        playerId: player.id,
        phase: Phase.INIT,
        round: 0,
        timestamp: Date.now() - (playerAgents.length - index) * 1000,
        details: { playerName: player.name },
      });
    }

    return gameState;
  }

  /**
   * Saves game state to the House agent's memory using the new memory DAO format
   */
  static async saveGameStateToRuntime(
    houseRuntime: IAgentRuntime,
    roomId: UUID,
    gameState: GameState
  ): Promise<void> {
    // Use the memory DAO to save the game state properly
    await saveGameState(houseRuntime, roomId, gameState);
  }

  /**
   * Convenience method to pre-load a standard 5-player game ready to start
   */
  static async preloadInfluenceGame<Context extends Record<string, unknown>>(
    houseRuntime: IAgentRuntime,
    roomId: UUID,
    options: {
      playerAgents: Agent<Context>[];
      phase?: Phase;
    }
  ): Promise<GameState> {
    const { playerAgents = [], phase = Phase.INIT } = options;

    const gameState = this.createGameState({
      houseRuntime,
      playerAgents,
      phase,
      round: phase === Phase.LOBBY ? 0 : 1,
    });

    await this.saveGameStateToRuntime(houseRuntime, roomId, gameState);

    console.log(
      `🎮 Pre-loaded game state: ${playerAgents.length} players, phase ${phase}, host: ${houseRuntime.character.name}`
    );

    return gameState;
  }

  /**
   * Pre-load game state with players already in LOBBY phase
   */
  static async preloadLobbyPhase<Context extends Record<string, unknown>>({
    roomId,
    houseRuntime,
    playerAgents,
  }: {
    roomId: UUID;
    houseRuntime: IAgentRuntime;
    playerAgents: Agent<Context>[];
  }): Promise<GameState> {
    const gameState = this.createGameState({
      playerAgents,
      phase: Phase.LOBBY,
      round: 0,
      houseRuntime,
    });

    // Add game start event to history
    gameState.history.push({
      id: stringToUuid(`game-start-${Date.now()}`),
      type: "GAME_STARTED",
      playerId: gameState.hostId!,
      phase: Phase.LOBBY,
      round: 0,
      timestamp: Date.now(),
      details: { playerCount: gameState.players.size },
    });

    gameState.timerEndsAt = Date.now() + gameState.settings.timers.lobby;

    await this.saveGameStateToRuntime(houseRuntime, roomId, gameState);

    console.log(
      `🎮 Pre-loaded LOBBY phase: ${playerAgents.length} players ready for conversation`
    );

    return gameState;
  }

  /**
   * Pre-load game state for testing specific phases
   */
  static async preloadGamePhase<Context extends Record<string, unknown>>({
    houseRuntime,
    roomId,
    phase,
    playerAgents,
    round = 1,
    empoweredPlayer,
    exposedPlayers = [],
  }: {
    houseRuntime: IAgentRuntime;
    roomId: UUID;
    phase: Phase;
    playerAgents: Agent<Context>[];
    round?: number;
    empoweredPlayer?: string;
    exposedPlayers?: string[];
  }): Promise<GameState> {
    const gameState = this.createGameState({
      playerAgents,
      houseRuntime,
      phase,
      round,
    });

    // Set phase-specific state
    if (empoweredPlayer) {
      const empoweredPlayerId = Array.from(gameState.players.values()).find(
        (p) => p.name === empoweredPlayer
      )?.id;
      if (empoweredPlayerId) {
        gameState.empoweredPlayer = empoweredPlayerId;
      }
    }

    // Set exposed players
    exposedPlayers.forEach((playerName) => {
      const playerId = Array.from(gameState.players.values()).find(
        (p) => p.name === playerName
      )?.id;
      if (playerId) {
        gameState.exposedPlayers.add(playerId);
      }
    });

    // Set appropriate timer
    const phaseTimer =
      gameState.settings.timers[
        phase.toLowerCase() as keyof typeof gameState.settings.timers
      ];
    gameState.timerEndsAt = Date.now() + phaseTimer;

    await this.saveGameStateToRuntime(houseRuntime, roomId, gameState);

    console.log(
      `🎮 Pre-loaded ${phase} phase: ${playerAgents.length} players, round ${round}`
    );

    return gameState;
  }
}
