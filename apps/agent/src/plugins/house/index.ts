import {
  Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventPayload,
  EventType,
} from "@elizaos/core";
import {
  joinGameAction,
  startGameAction,
  requestPrivateRoomAction,
  introductionMessageAction,
} from "./actions";
import {
  gameStateProvider,
  phaseActionsProvider,
  playerRelationsProvider,
  gameMasterProvider,
} from "./providers";
import {
  CoordinationService,
  Phase,
  GameEventType,
  GameEventHandlers,
} from "../coordinator";

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
  actions: [
    joinGameAction,
    startGameAction,
    requestPrivateRoomAction,
    introductionMessageAction,
  ],
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
    [GameEventType.I_AM_READY]: [
      async ({
        runtime,
        playerId,
        playerName,
        readyType,
        targetPhase,
        gameId,
        roomId,
      }) => {
        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        if (!coordinationService) {
          logger.warn(
            "CoordinationService not available for readiness tracking",
          );
          return;
        }

        logger.info(
          `House received I_AM_READY from ${playerName} for ${readyType} → ${targetPhase}`,
        );

        // Get plugin settings
        const minPlayers = parseInt(
          runtime.getSetting("HOUSE_MIN_PLAYERS") || "4",
        );
        const maxPlayers = parseInt(
          runtime.getSetting("HOUSE_MAX_PLAYERS") || "8",
        );

        // Track readiness state in cache
        const readinessCacheKey = `game_readiness_${gameId}_${readyType}`;
        const existingReadiness =
          (await runtime.getCache(readinessCacheKey)) || {};
        existingReadiness[playerId] = {
          playerName,
          readyAt: Date.now(),
          targetPhase,
        };
        await runtime.setCache(readinessCacheKey, existingReadiness);

        // Get all participants in the room to check if everyone is ready
        const participants = await runtime.getParticipantsForRoom(roomId);
        const playerParticipants = participants.filter(
          (p) => p !== runtime.agentId,
        );

        const readyPlayerIds = Object.keys(existingReadiness);
        const allPlayersReady = playerParticipants.every((p) =>
          readyPlayerIds.includes(p),
        );

        logger.info(
          `Readiness check: ${readyPlayerIds.length}/${playerParticipants.length} players ready for ${readyType}`,
        );

        // If all players are ready and we have minimum players, transition phase
        if (allPlayersReady && playerParticipants.length >= minPlayers) {
          logger.info("All players ready! House initiating phase transition");

          // Clear readiness cache for this readiness type
          await runtime.setCache(readinessCacheKey, {});

          if (
            readyType === "phase_action" &&
            targetPhase === Phase.INTRODUCTION
          ) {
            await coordinationService.sendGameEvent({
              gameId,
              roomId,
              phase: Phase.INTRODUCTION,
              round: 1,
              previousPhase: Phase.INIT,
              timestamp: Date.now(),
              runtime,
              source: "house-plugin",
              type: GameEventType.PHASE_STARTED,
            });
          } else if (
            readyType === "phase_action" &&
            targetPhase === Phase.WHISPER
          ) {
            await coordinationService.sendGameEvent({
              gameId,
              roomId,
              phase: Phase.WHISPER,
              round: 1,
              previousPhase: Phase.LOBBY,
              timestamp: Date.now(),
              runtime,
              source: "house-plugin",
              type: GameEventType.PHASE_STARTED,
            });
          }
        }
      },
    ],
    [GameEventType.PHASE_STARTED]: [
      async ({ runtime, phase, gameId, roomId, round, previousPhase }) => {
        logger.info(
          `House handling PHASE_STARTED: ${previousPhase} → ${phase} (Round ${round})`,
        );

        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        if (!coordinationService) {
          logger.warn(
            "CoordinationService not available for phase announcements",
          );
          return;
        }

        // Store current phase in cache
        await runtime.setCache(`game_phase_${gameId}`, {
          phase,
          round,
          previousPhase,
          startedAt: Date.now(),
        });

        // Handle phase-specific orchestration
        if (phase === Phase.LOBBY) {
          // Announce LOBBY phase and request readiness for WHISPER
          await coordinationService.sendGameEvent({
            gameId,
            roomId,
            readyType: "phase_action",
            targetPhase: Phase.WHISPER,
            timeoutMs: 300000, // 5 minutes
            timestamp: Date.now(),
            runtime,
            source: "house-plugin",
            type: GameEventType.ARE_YOU_READY,
          });
        }
      },
    ],
  } as GameEventHandlers,
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      const minPlayers = runtime.getSetting("HOUSE_MIN_PLAYERS") || "4";
      const maxPlayers = runtime.getSetting("HOUSE_MAX_PLAYERS") || "8";
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
