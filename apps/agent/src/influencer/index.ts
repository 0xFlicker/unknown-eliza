import { EventHandler, EventPayload, Plugin, elizaLogger } from "@elizaos/core";
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
import { StrategyService } from "../socialStrategy/service/addPlayer";

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
  providers: [
    shouldRespondProvider,
    phaseContextProvider,
    gameContextProvider,
  ],
  init: async (_config, _runtime) => {
    console.log("🎭 Influencer plugin initialized - ready to play the game");
  },
};
