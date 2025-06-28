import { Plugin } from "@elizaos/core";
import {
  joinGameAction,
  startGameAction,
  requestPrivateRoomAction,
} from "./actions";
import {
  gameStateProvider,
  phaseActionsProvider,
  playerRelationsProvider,
  gameMasterProvider,
} from "./providers";

/**
 * The House plugin manages the game phases and orchestrates the Influence game.
 */
export const housePlugin: Plugin = {
  name: "influence-house",
  description:
    "Game master (House) plugin for the Influence social strategy game",
  actions: [joinGameAction, startGameAction, requestPrivateRoomAction],
  providers: [
    gameStateProvider,
    phaseActionsProvider,
    playerRelationsProvider,
    gameMasterProvider,
  ],
  init: async (_config, _runtime) => {
    console.log(
      "🏠 House plugin initialized - ready to moderate Influence games",
    );
  },
};
