import { IAgentRuntime, stringToUuid, UUID } from "@elizaos/core";
import { saveGameState } from "../../plugins/house/memory/runtime";
import { GameState } from "../../plugins/house/memory/types";
import { Agent } from "../../server/types";
import { Phase } from "@/plugins/house/game/types";
import { GameSettings, Player, PlayerStatus } from "@/plugins/house/game/types";
import { GameConfig, GameSession } from "@/server/game-manager";
import {
  createPhaseActor,
  createPhaseMachine,
  PhaseInput,
} from "@/plugins/house/game/phase";

/**
 * Utility for pre-loading game state in tests to skip the initialization phases
 * and jump directly to testing specific game phases.
 */
export class GameStatePreloader<Context extends Record<string, unknown>> {
  /**
   * Creates a pre-populated game state with specified players
   */
  static createGameSession<Context extends Record<string, unknown>>(options: {
    runtime: IAgentRuntime;
    config: GameConfig;
    gameId?: UUID; // Use provided gameId instead of generating one
  }): GameSession {
    const { runtime, config, gameId: providedGameId } = options;

    const gameId = providedGameId || stringToUuid(`test-game-${Date.now()}`);
    const phaseInput: PhaseInput = {
      players: config.players,
      maxPlayers: config.settings?.maxPlayers || 8,
      minPlayers: config.settings?.minPlayers || 4,
    };

    const phaseSettings: GameSettings = {
      id: gameId,
      maxWhispersPerPlayer: config.settings?.maxWhispersPerPlayer || 3,
      timers: {
        whisper: config.settings?.phaseTimeouts?.whisper || 360000,
        whisper_pick: config.settings?.phaseTimeouts?.whisperPick || 10000,
        whisper_room: config.settings?.phaseTimeouts?.whisperRoom || 10000,
        diary: config.settings?.phaseTimeouts?.diary || 120000,
        round: config.settings?.phaseTimeouts?.round || 720000,
      },
    };

    const gameSession: GameSession = {
      id: gameId,
      name: config.name || `Game ${gameId.substring(0, 8)}`,
      settings: {
        minPlayers: config.settings?.minPlayers || 4,
        maxPlayers: config.settings?.maxPlayers || 8,
        autoStartGame: true,
        ...config.settings,
      },
      players: config.players,
      channels: new Set(),
      createdAt: Date.now(),
      phaseInput,
      phaseSettings,
      phase: createPhaseActor(
        createPhaseMachine({
          id: gameId,
          maxWhispersPerPlayer: phaseSettings.maxWhispersPerPlayer,
          timers: phaseSettings.timers,
        }),
        phaseInput,
      ),
    };

    gameSession.phase.start();

    return gameSession;
  }

  /**
   * Saves game state to the House agent's memory using the new memory DAO format
   */
  static async saveGameStateToRuntime(
    runtime: IAgentRuntime,
    gameId: UUID,
    gameState: GameState,
  ): Promise<void> {
    // Use the memory DAO to save the game state properly
    await saveGameState(runtime, gameId, gameState);
  }

  /**
   * Convenience method to pre-load a standard 5-player game ready to start
   */
  static async preloadInfluenceGame<Context extends Record<string, unknown>>(
    runtime: IAgentRuntime,
    options: {
      playerAgents: Agent<Context>[];
      phase?: Phase;
    },
  ): Promise<GameSession> {
    const { playerAgents = [], phase = Phase.INIT } = options;

    const gameState = this.createGameSession({
      runtime,
      config: {
        players: playerAgents.map((agent) => agent.id),
        settings: {},
      },
    });

    await this.saveGameStateToRuntime(runtime, gameState.id, {
      id: gameState.id,
      gameSettings: gameState.phaseSettings,
      phaseInput: gameState.phaseInput,
      phaseSnapshot: gameState.phase.getPersistedSnapshot(),
    });

    console.log(
      `🎮 Pre-loaded game state: ${playerAgents.length} players, phase ${phase}, host: ${runtime.character.name}`,
    );

    return gameState;
  }

  /**
   * Pre-load game state with players already in LOBBY phase
   */
  static async preloadLobbyPhase<Context extends Record<string, unknown>>({
    roomId,
    runtime,
    playerAgents,
  }: {
    roomId: UUID;
    runtime: IAgentRuntime;
    playerAgents: Agent<Context>[];
  }): Promise<GameSession> {
    const gameState = this.createGameSession({
      runtime,
      config: {
        players: playerAgents.map((agent) => agent.id),
        settings: {},
      },
    });

    const { phase } = gameState;

    await this.saveGameStateToRuntime(runtime, gameState.id, {
      id: gameState.id,
      gameSettings: gameState.phaseSettings,
      phaseInput: gameState.phaseInput,
      phaseSnapshot: gameState.phase.getPersistedSnapshot(),
    });

    console.log(
      `🎮 Pre-loaded LOBBY phase: ${playerAgents.length} players ready for conversation`,
    );

    return gameState;
  }

  /**
   * Pre-load game state for testing specific phases
   */
  static async preloadGamePhase<Context extends Record<string, unknown>>({
    runtime,
    phase,
    playerAgents,
  }: {
    runtime: IAgentRuntime;
    roomId: UUID;
    phase: Phase;
    playerAgents: Agent<Context>[];
  }): Promise<GameSession> {
    const gameState = this.createGameSession({
      runtime,
      config: {
        players: playerAgents.map((agent) => agent.id),
        settings: {},
      },
    });

    await this.saveGameStateToRuntime(runtime, gameState.id, {
      id: gameState.id,
      gameSettings: gameState.phaseSettings,
      phaseInput: gameState.phaseInput,
      phaseSnapshot: gameState.phase.getPersistedSnapshot(),
    });

    console.log(`🎮 Pre-loaded ${phase} phase: ${playerAgents.length} players`);

    return gameState;
  }
}
