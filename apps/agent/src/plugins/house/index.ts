import {
  Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventType,
} from "@elizaos/core";
// House plugin is event-driven, not action-based
import {
  gameStateProvider,
  phaseActionsProvider,
  playerRelationsProvider,
  gameMasterProvider,
} from "./providers";
import { CoordinationService, Phase, GameEventType } from "../coordinator";
import internalMessageBus from "../coordinator/bus";
import {
  updateIntroduction,
  isIntroductionPhaseComplete,
  transitionToPhase,
  getGameState,
} from "../../memory/gameState";
import { MessageServiceStructure } from "@elizaos/server";

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
    [EventType.ENTITY_JOINED]: [
      async (payload) => {
        console.log(
          `🏠 House received ENTITY_JOINED event for agent ${payload.entityId}`,
        );
        const autoStart =
          payload.runtime.getSetting("HOUSE_AUTO_START") || "true";
        if (autoStart === "true") {
          console.log("🏠 Auto-starting game");
        }
      },
    ],
    [EventType.MESSAGE_RECEIVED]: [
      async (payload) => {
        console.log(
          `🏠 House received MESSAGE_RECEIVED event for agent ${payload.message.agentId} in room ${payload.message.roomId}`,
        );
      },
    ],
  },
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      const minPlayers = runtime.getSetting("HOUSE_MIN_PLAYERS") || "4";
      const maxPlayers = runtime.getSetting("HOUSE_MAX_PLAYERS") || "8";

      // Set up internal message bus listener for INTRODUCTION phase tracking
      internalMessageBus.on(
        "new_message",
        async (message: MessageServiceStructure) => {
          // Only process non-House messages during INTRODUCTION phase
          if (message.author_id === runtime.agentId) return;

          const playerId = message.author_id;
          const roomId = message.channel_id;

          logger.debug(
            `🏠 House processing message from ${playerId} in room ${roomId}`,
          );

          // Update introduction tracking using DAO
          const gameState = await getGameState(runtime, roomId);
          if (!gameState) {
            logger.debug(`🏠 No game state for room ${roomId}`);
            return;
          }
          const updatedGameState = await updateIntroduction({
            gameState,
            runtime,
            roomId,
            playerId,
          });
          if (!updatedGameState) {
            logger.debug(`🏠 No game state or wrong phase for room ${roomId}`);
            return;
          }

          // Check if all players have introduced themselves using DAO
          if (isIntroductionPhaseComplete(updatedGameState)) {
            logger.info(
              `🎮 All players introduced - House initiating INTRODUCTION → LOBBY transition`,
            );

            const coordinationService = runtime.getService(
              CoordinationService.serviceType,
            ) as CoordinationService;
            if (coordinationService) {
              logger.info("🎮 Emitting PHASE_TRANSITION_INITIATED event");
              // Emit PHASE_TRANSITION_INITIATED
              await coordinationService.sendGameEvent({
                type: GameEventType.PHASE_TRANSITION_INITIATED,
                gameId: updatedGameState.id,
                roomId,
                timestamp: Date.now(),
                fromPhase: Phase.INTRODUCTION,
                toPhase: Phase.LOBBY,
                round: updatedGameState.round,
                transitionReason: "all_players_ready",
                requiresStrategicThinking: false,
                requiresDiaryRoom: false,
                runtime,
                source: "house-plugin",
              });

              // Then emit PHASE_STARTED for LOBBY
              await coordinationService.sendGameEvent({
                type: GameEventType.PHASE_STARTED,
                gameId: updatedGameState.id,
                roomId,
                timestamp: Date.now(),
                phase: Phase.LOBBY,
                round: updatedGameState.round,
                previousPhase: Phase.INTRODUCTION,
                runtime,
                source: "house-plugin",
              });

              // Update game state to LOBBY phase using DAO
              await transitionToPhase({
                gameState: updatedGameState,
                runtime,
                roomId,
                toPhase: Phase.LOBBY,
              });
            }
          }
        },
      );

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
