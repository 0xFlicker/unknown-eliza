import {
  EventHandler,
  EventPayload,
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
} from "../house/events/types";
import { Phase } from "../house/types";
import { CoordinationService } from "../house/coordination";

const logger = elizaLogger.child({ component: "InfluencerPlugin" });

/**
 * Utility type for properly typed game event handlers in plugins
 */
type GameEventHandlers = Plugin["events"] & {
  [key in keyof GameEventPayloadMap]?: GameEventHandler<key>;
};

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
    [GameEventType.PHASE_STARTED]: [
      async ({ message, runtime }) => {
        const phase = message.payload.phase;
        if (phase === Phase.INIT) {
          const coordinationService = runtime.getService(
            CoordinationService.serviceType
          ) as CoordinationService;
          if (!coordinationService) {
            logger.warn(
              "CoordinationService not available for introduction response"
            );
            return;
          }

          await coordinationService.sendGameEvent(GameEventType.I_AM_READY, {
            runtime,
            gameId: message.payload.gameId,
            roomId: message.payload.roomId,
            playerId: runtime.agentId,
            playerName: runtime.character?.name || "Unknown Player",
            readyType: "phase_action",
            targetPhase: Phase.LOBBY,
            timestamp: Date.now(),
            source: "influencer-plugin",
          });
        }
      },
    ],
  } as unknown as PluginEvents & GameEventHandlers, // seems to be required as far as I can tell
};
