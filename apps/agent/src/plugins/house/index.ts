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
} from "./actions";
import {
  gameStateProvider,
  phaseActionsProvider,
  playerRelationsProvider,
  gameMasterProvider,
} from "./providers";
import { phaseTimerEvaluator } from "./evaluators/phaseTimer";
import {
  GameEventType,
  GameEventHandler,
  GameEventPayloadMap,
} from "./events/types";

const logger = elizaLogger.child({ component: "HousePlugin" });

/**
 * Utility type for properly typed game event handlers in plugins
 */
export type GameEventHandlers = Plugin["events"] & {
  [key in keyof GameEventPayloadMap]?: GameEventHandler<key>;
};

/**
 * The House plugin manages the game phases and orchestrates the Influence game.
 */
export const housePlugin: Plugin = {
  name: "influence-house",
  description:
    "Game master (House) plugin for the Influence social strategy game with event-driven phase coordination",
  actions: [joinGameAction, startGameAction, requestPrivateRoomAction],
  providers: [
    gameStateProvider,
    phaseActionsProvider,
    playerRelationsProvider,
    gameMasterProvider,
  ],
  evaluators: [phaseTimerEvaluator],
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      logger.info(
        "🏠 House plugin initialized - ready to moderate Influence games"
      );
    } else {
      logger.info(
        "🏠 House plugin initialized - ready to moderate Influence games"
      );
    }
  },
};
