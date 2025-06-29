import { IAgentRuntime, stringToUuid, UUID } from "@elizaos/core";
import { saveGameState } from "../../src/house/runtime/memory";
import {
  GameState,
  Player,
  PlayerStatus,
  Phase,
  DEFAULT_GAME_SETTINGS,
} from "../../src/house/types";

/**
 * Utility for pre-loading game state in tests to skip the initialization phases
 * and jump directly to testing specific game phases.
 */
export class GameStatePreloader {
  /**
   * Creates a pre-populated game state with specified players
   */
  static createGameState(options: {
    playerNames: string[];
    hostPlayerName: string;
    phase: Phase;
    round?: number;
    playerAgentIds?: Map<string, UUID>; // Map from player name to actual agent ID
  }): GameState {
    const {
      playerNames,
      hostPlayerName,
      phase,
      round = 0,
      playerAgentIds,
    } = options;

    const players = new Map<string, Player>();
    const gameId = stringToUuid(`test-game-${Date.now()}`);

    // Create players with real agent IDs if provided
    playerNames.forEach((name, index) => {
      const playerId =
        playerAgentIds?.get(name) ||
        stringToUuid(`test-player-${name}-${Date.now()}`);
      const player: Player = {
        id: playerId,
        agentId: playerId,
        name,
        status: PlayerStatus.ALIVE,
        isHost: name === hostPlayerName,
        joinedAt: Date.now() - (playerNames.length - index) * 1000, // Stagger join times
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
      settings: { ...DEFAULT_GAME_SETTINGS },
      history: [],
      isActive: phase !== Phase.INIT,
      hostId: Array.from(players.values()).find((p) => p.isHost)?.id,
    };

    // Add join events to history
    playerNames.forEach((name, index) => {
      const player = Array.from(players.values()).find((p) => p.name === name);
      if (player) {
        gameState.history.push({
          id: stringToUuid(`join-event-${name}-${Date.now()}`),
          type: "PLAYER_JOINED",
          playerId: player.id,
          phase: Phase.INIT,
          round: 0,
          timestamp: Date.now() - (playerNames.length - index) * 1000,
          details: { playerName: name },
        });
      }
    });

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
  static async preloadInfluenceGame(
    houseRuntime: IAgentRuntime,
    roomId: UUID,
    options: {
      playerNames?: string[];
      hostPlayerName?: string;
      phase?: Phase;
      playerAgentIds?: Map<string, UUID>;
    } = {}
  ): Promise<GameState> {
    const {
      playerNames = ["P1", "P2", "P3", "P4", "P5"],
      hostPlayerName = "P1",
      phase = Phase.INIT,
      playerAgentIds,
    } = options;

    const gameState = this.createGameState({
      playerNames,
      hostPlayerName,
      phase,
      round: phase === Phase.LOBBY ? 0 : 1,
      playerAgentIds,
    });

    await this.saveGameStateToRuntime(houseRuntime, roomId, gameState);

    console.log(
      `🎮 Pre-loaded game state: ${playerNames.length} players, phase ${phase}, host: ${hostPlayerName}`
    );

    return gameState;
  }

  /**
   * Pre-load game state with players already in LOBBY phase
   */
  static async preloadLobbyPhase(
    houseRuntime: IAgentRuntime,
    roomId: UUID,
    playerNames: string[] = ["P1", "P2", "P3", "P4", "P5"],
    playerAgentIds?: Map<string, UUID>
  ): Promise<GameState> {
    const gameState = this.createGameState({
      playerNames,
      hostPlayerName: playerNames[0],
      phase: Phase.LOBBY,
      round: 0,
      playerAgentIds,
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
      `🎮 Pre-loaded LOBBY phase: ${playerNames.length} players ready for conversation`
    );

    return gameState;
  }

  /**
   * Pre-load game state for testing specific phases
   */
  static async preloadGamePhase(
    houseRuntime: IAgentRuntime,
    roomId: UUID,
    phase: Phase,
    options: {
      playerNames?: string[];
      hostPlayerName?: string;
      round?: number;
      empoweredPlayer?: string;
      exposedPlayers?: string[];
    } = {}
  ): Promise<GameState> {
    const {
      playerNames = ["P1", "P2", "P3", "P4", "P5"],
      hostPlayerName = "P1",
      round = 1,
      empoweredPlayer,
      exposedPlayers = [],
    } = options;

    const gameState = this.createGameState({
      playerNames,
      hostPlayerName,
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
      `🎮 Pre-loaded ${phase} phase: ${playerNames.length} players, round ${round}`
    );

    return gameState;
  }
}
