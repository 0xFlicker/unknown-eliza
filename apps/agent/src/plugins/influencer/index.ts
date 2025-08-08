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
import { GameEventHandlers } from "../coordinator/types";
import { CoordinationService } from "../coordinator";
import { Phase } from "@/memory/types";

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
    ["GAME:ARE_YOU_READY"]: [
      async ({ runtime, gameId, roomId, action }) => {
        console.log(
          `🎭 Influencer(${runtime.character?.name}) received GAME:ARE_YOU_READY for game ${gameId} room ${roomId}`,
        );
        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        if (!coordinationService) {
          logger.warn(
            "CoordinationService not available for ARE_YOU_READY response",
          );
          return;
        }
        console.log(
          `🎭 Influencer(${runtime.character?.name}) sending PLAYER_READY`,
        );
        await coordinationService.sendGameEvent(
          {
            gameId,
            roomId,
            action: { type: "PLAYER_READY", playerId: runtime.agentId },
            timestamp: Date.now(),
            runtime,
            source: "influencer-plugin",
          },
          "others",
        );
      },
    ],
    ["GAME:PHASE_STARTED"]: [
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

          await coordinationService.sendGameEvent(
            {
              gameId,
              roomId,
              action: { type: "PLAYER_READY", playerId: runtime.agentId },
              timestamp: Date.now(),
              runtime,
              source: "influencer-plugin",
            },
            "others",
          );
        }
      },
    ],
  } as GameEventHandlers,
};
