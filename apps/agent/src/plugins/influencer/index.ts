import {
  EventHandler,
  EventPayload,
  EventPayloadMap,
  Plugin,
  PluginEvents,
  elizaLogger,
} from "@elizaos/core";
import {
  shouldRespondProvider,
  phaseContextProvider,
  gameContextProvider,
} from "./providers";
import {
  ignoreHouseAction,
  joinLobbyAction,
  requestStartAction,
  createPrivateRoomAction,
  publicStatementAction,
  empowerVoteAction,
  exposeVoteAction,
  eliminateAction,
  protectAction,
} from "./actions";
import {
  GameEventType,
  GameEventHandler,
  GameEventPayloadMap,
  GameEventHandlers,
} from "../house/events/types";
import { Phase } from "../house/types";
import { CoordinationService } from "../coordinator";

const logger = elizaLogger.child({ component: "InfluencerPlugin" });

/**
 * The influencer plugin adds player-side logic for the Influence game.
 * It provides strategic context and guides player behavior through all game phases.
 */
export const influencerPlugin: Plugin = {
  name: "influence-player",
  description: "Player plugin for the Influence social strategy game",
  actions: [
    ignoreHouseAction,
    joinLobbyAction,
    requestStartAction,
    createPrivateRoomAction,
    publicStatementAction,
    empowerVoteAction,
    exposeVoteAction,
    eliminateAction,
    protectAction,
  ],
  providers: [shouldRespondProvider, phaseContextProvider, gameContextProvider],
  init: async (_config, _runtime) => {
    console.log("🎭 Influencer plugin initialized - ready to play the game");
  },
  events: {
    // Coordination handled via internal bus; no MESSAGE_RECEIVED hook needed.
    [GameEventType.ARE_YOU_READY]: [
      async ({ runtime, gameId, roomId, readyType, targetPhase }) => {
        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        if (!coordinationService) {
          logger.warn(
            "CoordinationService not available for ARE_YOU_READY response",
          );
          return;
        }

        logger.info(
          `${runtime.character?.name} responding to ARE_YOU_READY for ${readyType}`,
        );

        await coordinationService.sendGameEvent(GameEventType.I_AM_READY, {
          gameId,
          roomId,
          playerId: runtime.agentId,
          playerName: runtime.character?.name || "Unknown Player",
          readyType: readyType,
          targetPhase: targetPhase,
          timestamp: Date.now(),
          runtime,
          source: "influencer-plugin",
        });
      },
    ],
    [GameEventType.PHASE_STARTED]: [
      async ({ runtime, phase, gameId, roomId }) => {
        if (phase === Phase.INIT) {
          const coordinationService = runtime.getService(
            CoordinationService.serviceType,
          ) as CoordinationService;
          if (!coordinationService) {
            logger.warn(
              "CoordinationService not available for introduction response",
            );
            return;
          }

          await coordinationService.sendGameEvent(GameEventType.I_AM_READY, {
            gameId,
            roomId,
            playerId: runtime.agentId,
            playerName: runtime.character?.name || "Unknown Player",
            readyType: "phase_action",
            targetPhase: Phase.LOBBY,
            timestamp: Date.now(),
            runtime,
            source: "influencer-plugin",
          });
        }
      },
    ],
    [GameEventType.DIARY_ROOM_OPENED]: [
      async ({ runtime, gameId, roomId }) => {
        logger.info(`Diary room opened for ${runtime.character?.name}`, {
          gameId,
          roomId,
        });

        // The coordination system will create a synthetic message
        // that should trigger the diary room action
      },
    ],
  } as GameEventHandlers,
};
