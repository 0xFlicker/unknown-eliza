import { Plugin } from "@elizaos/core";
import {
  gameContextProvider,
  playerAnalysisProvider,
  strategyProvider,
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
  providers: [gameContextProvider, playerAnalysisProvider, strategyProvider],
  init: async (_config, _runtime) => {
    console.log("🎭 Influencer plugin initialized - ready to play the game");
  },
};
