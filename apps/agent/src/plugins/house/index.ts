import {
  Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventType,
} from "@elizaos/core";
// House plugin is event-driven, not action-based
import { gameStateProvider } from "./providers";
import { GameEventHandlers } from "../coordinator";
import { getGameState } from "@/memory/runtime";
import { GameStateManager } from "./gameStateManager";

const logger = elizaLogger.child({ component: "HousePlugin" });

/**
 * Configuration interface for House plugin
 */
export interface HousePluginConfig {
  minPlayers?: number;
  maxPlayers?: number;
  autoStartGame?: boolean;
  phaseTimeouts?: {
    diary?: number;
    round?: number;
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
  actions: [], // House is event-driven, not action-based
  providers: [gameStateProvider],
  evaluators: [],
  services: [GameStateManager],
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
    [EventType.ENTITY_JOINED]: [
      async (payload) => {
        if (payload.entityId !== payload.runtime.agentId && payload.worldId) {
          const gameStateManager = payload.runtime.getService<GameStateManager>(
            GameStateManager.serviceType,
          );
          console.log(
            `🏠 House received ENTITY_JOINED event for agent ${payload.entityId} in world ${payload.worldId}`,
          );
          await gameStateManager?.addPlayer(payload.worldId, payload.entityId);
        }
        console.log(
          `🏠 House received ENTITY_JOINED event for agent ${payload.entityId}`,
        );
        // Ensure phase system is initialized for this world if not already
        if (payload.worldId) {
          const minPlayers = Number(
            payload.runtime.getSetting("HOUSE_MIN_PLAYERS") || 4,
          );
          const maxPlayers = Number(
            payload.runtime.getSetting("HOUSE_MAX_PLAYERS") || 8,
          );
          const autoStart =
            payload.runtime.getSetting("HOUSE_AUTO_START") || "true";
          try {
            const existing = await getGameState(
              payload.runtime,
              payload.worldId,
            );
            if (!existing) {
              console.log(
                `🏠 Initializing phase on first ENTITY_JOINED for world ${payload.worldId}`,
              );
              const gameStateManager =
                payload.runtime.getService<GameStateManager>(
                  GameStateManager.serviceType,
                );
              await gameStateManager?.initializePhase(
                payload.worldId,
                {
                  id: payload.worldId,
                  timers: {
                    diary: 60000,
                    round: 60000,
                  },
                },
                {
                  maxPlayers,
                  minPlayers,
                  players: [],
                },
              );
              if (autoStart === "true") {
                console.log("🏠 Auto-start enabled for this world");
              }
            }
          } catch (e) {
            console.log(
              `🏠 Failed to check/init phase for world ${payload.worldId}:`,
              e,
            );
          }
        }
      },
    ],
    [EventType.MESSAGE_RECEIVED]: [
      async (payload) => {
        // console.log(
        //   `🏠 House received MESSAGE_RECEIVED event for agent ${payload.message.agentId} in room ${payload.message.roomId}`
        // );
      },
    ],
  } as GameEventHandlers,
  init: async (config, runtime: IAgentRuntime) => {},
};
