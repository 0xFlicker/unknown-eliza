import { Plugin } from "@elizaos/core";
import { lobbyContextProvider } from "./providers";

/**
 * The influencer plugin adds player-side logic for the Influence game.
 * It provides context about the lobby phase and will parse player commands.
 */
export const influencerPlugin: Plugin = {
  name: "influence-player",
  description: "Player plugin for the Influence social strategy game",
  init: async (_config, _runtime) => {},
  providers: [lobbyContextProvider],
};
