import { Plugin } from "@elizaos/core";
import { Phase } from "./types";

/**
 * The House plugin manages the game phases and orchestrates the Influence game.
 */
export const housePlugin: Plugin = {
  name: "influence-house",
  description:
    "Game master (House) plugin for the Influence social strategy game",
  init: async (_config, _runtime) => {},
};
