import { Plugin, type IAgentRuntime, elizaLogger } from "@elizaos/core";
// House plugin is event-driven, not action-based
import {
  gameStateProvider,
  phaseActionsProvider,
  playerRelationsProvider,
  gameMasterProvider,
} from "./providers";
import { CoordinationService, Phase, GameEventType } from "../coordinator";
import internalMessageBus from "../coordinator/bus";
import { GameState, MemoryGameEvent, PhaseState } from "./types";

const logger = elizaLogger.child({ component: "HousePlugin" });

/**
 * Configuration interface for House plugin
 */
export interface HousePluginConfig {
  minPlayers?: number;
  maxPlayers?: number;
  autoStartGame?: boolean;
  phaseTimeouts?: {
    introduction?: number;
    lobby?: number;
    whisper?: number;
    rumor?: number;
    vote?: number;
    power?: number;
  };
}

/**
 * The House plugin manages the game phases and orchestrates the Influence game.
 */
export const housePlugin: Plugin = {
  name: "influence-house",
  description:
    "Game master (House) plugin for the Influence social strategy game with event-driven phase coordination",
  actions: [], // House is event-driven, not action-based
  providers: [
    gameStateProvider,
    phaseActionsProvider,
    playerRelationsProvider,
    gameMasterProvider,
  ],
  evaluators: [],
  config: {
    HOUSE_MIN_PLAYERS: {
      type: "number",
      description: "Minimum number of players required to start the game",
      defaultValue: 4,
      required: false,
    },
    HOUSE_MAX_PLAYERS: {
      type: "number",
      description: "Maximum number of players allowed in the game",
      defaultValue: 8,
      required: false,
    },
    HOUSE_AUTO_START: {
      type: "boolean",
      description:
        "Whether to automatically start the game when enough players join",
      defaultValue: true,
      required: false,
    },
  },
  events: {
    // House plugin uses internal message bus for chat message processing
    // Event handlers are set up in the init function
  },
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      const minPlayers = runtime.getSetting("HOUSE_MIN_PLAYERS") || "4";
      const maxPlayers = runtime.getSetting("HOUSE_MAX_PLAYERS") || "8";

      // Set up internal message bus listener for INTRODUCTION phase tracking
      internalMessageBus.on("new_message", async (message) => {
        // Only process non-House messages during INTRODUCTION phase
        if (message.author_id === runtime.agentId) return;

        // Get game state to check current phase
        const gameState = await runtime.getMemories({
          roomId: message.channel_id,
          count: 10,
          tableName: "memories",
        });

        // Find most recent game state
        const gameStateMemory = gameState.find(
          (m) =>
            m.metadata?.type === "game" &&
            m.metadata?.gameEventType === "game_state",
        );

        if (!gameStateMemory?.content?.gameState) {
          console.log("🏠 No game state found - returning");
          return;
        }

        const currentGameState = {
          ...(gameStateMemory.content.gameState as MemoryGameEvent),
          phaseState: {
            ...(gameStateMemory.content.gameState as MemoryGameEvent)
              .phaseState,
            introductionMessages: new Map(
              Object.entries(
                (gameStateMemory.content.gameState as MemoryGameEvent)
                  .phaseState.introductionMessages,
              ),
            ),
            introductionComplete: new Set(
              (
                gameStateMemory.content.gameState as MemoryGameEvent
              ).phaseState.introductionComplete,
            ),
          },
        } as GameState;

        // Only track during INTRODUCTION phase
        if (
          currentGameState.phase !== Phase.INTRODUCTION ||
          !currentGameState.isActive
        ) {
          console.log(
            `🏠 Wrong phase or inactive - phase: ${currentGameState.phase}, isActive: ${currentGameState.isActive}`,
          );
          return;
        }

        const playerId = message.author_id;
        const currentCount =
          currentGameState.phaseState.introductionMessages.get(playerId) || 0;

        // Only count first message from each player
        if (currentCount >= 1) {
          console.log(
            `🎭 Player ${playerId} already introduced - ignoring additional message`,
          );
          return;
        }

        // Track this introduction
        currentGameState.phaseState.introductionMessages.set(
          playerId,
          currentCount + 1,
        );
        currentGameState.phaseState.introductionComplete.add(playerId);

        await runtime.createMemory(
          {
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: message.channel_id,
            createdAt: Date.now(),
            content: {
              text: `Game state updated - Phase: ${currentGameState.phase}, Round: ${currentGameState.round}, Introductions: ${currentGameState.phaseState.introductionComplete.size}/${Object.keys(currentGameState.players).length}`,
              gameState: {
                ...currentGameState,
                phaseState: {
                  ...currentGameState.phaseState,
                  introductionMessages: Object.fromEntries(
                    currentGameState.phaseState.introductionMessages,
                  ),
                  introductionComplete: Array.from(
                    currentGameState.phaseState.introductionComplete,
                  ),
                },
              },
            },
            metadata: {
              type: "game",
              gameEventType: "game_state",
              gameId: currentGameState.id,
              gamePhase: currentGameState.phase,
              gameRound: currentGameState.round,
              timestamp: Date.now(),
            },
          },
          "memories",
        );

        // Check if all players have introduced themselves
        const totalPlayers = Object.keys(currentGameState.players).length;
        const completedIntros =
          currentGameState.phaseState.introductionComplete.size;

        if (completedIntros >= totalPlayers) {
          console.log(
            `🎮 All players introduced - House initiating INTRODUCTION → LOBBY transition`,
          );

          const coordinationService = runtime.getService(
            CoordinationService.serviceType,
          ) as CoordinationService;
          if (coordinationService) {
            console.log("🎮 Emitting PHASE_TRANSITION_INITIATED event");
            // Emit PHASE_TRANSITION_INITIATED
            await coordinationService.sendGameEvent({
              type: GameEventType.PHASE_TRANSITION_INITIATED,
              gameId: currentGameState.id,
              roomId: message.channel_id,
              timestamp: Date.now(),
              fromPhase: Phase.INTRODUCTION,
              toPhase: Phase.LOBBY,
              round: currentGameState.round,
              transitionReason: "all_players_ready",
              requiresStrategicThinking: false,
              requiresDiaryRoom: false,
              runtime,
              source: "house-plugin",
            });

            // Then emit PHASE_STARTED for LOBBY
            await coordinationService.sendGameEvent({
              type: GameEventType.PHASE_STARTED,
              gameId: currentGameState.id,
              roomId: message.channel_id,
              timestamp: Date.now(),
              phase: Phase.LOBBY,
              round: currentGameState.round,
              previousPhase: Phase.INTRODUCTION,
              runtime,
              source: "house-plugin",
            });

            // Update and save game state
            currentGameState.phase = Phase.LOBBY;
            currentGameState.timerEndsAt =
              Date.now() + currentGameState.settings.timers.lobby;
            currentGameState.phaseState.introductionMessages = new Map();
            currentGameState.phaseState.introductionComplete = new Set();

            // Save updated game state
            await runtime.createMemory(
              {
                entityId: runtime.agentId,
                agentId: runtime.agentId,
                roomId: message.channel_id,
                createdAt: Date.now(),
                content: {
                  text: `Game state updated - Phase: ${currentGameState.phase}, Round: ${currentGameState.round}`,
                  gameState: currentGameState,
                },
                metadata: {
                  type: "game",
                  gameEventType: "game_state",
                  gameId: currentGameState.id,
                  gamePhase: currentGameState.phase,
                  gameRound: currentGameState.round,
                  timestamp: Date.now(),
                },
              },
              "memories",
            );
          }
        }
      });

      logger.info(
        `🏠 House plugin initialized - ready to moderate Influence games (${minPlayers}-${maxPlayers} players)`,
      );
    } else {
      logger.info(
        "🏠 House plugin initialized - ready to moderate Influence games",
      );
    }
  },
};
