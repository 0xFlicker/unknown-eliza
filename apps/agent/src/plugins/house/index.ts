import {
  Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventType,
} from "@elizaos/core";
// House plugin is event-driven, not action-based
import { gameStateProvider } from "./providers";
import { GameEventHandlers, CoordinationService } from "../coordinator";
import { getGameState } from "@/memory/runtime";
import { Phase } from "@/game/types";
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
    whisperRoom?: number;
    rumor?: number;
    vote?: number;
    power?: number;
  };
  // Whisper-specific settings for the WHISPER phase
  whisper?: {
    // How many whisper requests each player starts with (each request can be used to create a room or invite participants depending on house rules)
    maxWhisperRequests?: number;
    // How many messages a single player may send in a whisper room
    maxMessagesPerPlayerPerRoom?: number;
    // Per-room timeout in milliseconds
    whisperRoomTimeoutMs?: number;
    // Maximum participants allowed in a single whisper room (including owner)
    perRoomMaxParticipants?: number;
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
          // Ensure phase actor exists before adding players
          const minPlayers = 3;
          const maxPlayers = Number(
            payload.runtime.getSetting("HOUSE_MAX_PLAYERS") || 8,
          );
          await gameStateManager?.initializePhase(
            payload.worldId,
            {
              id: payload.worldId,
              timers: { diary: 60000, round: 60000 },
            },
            { maxPlayers, minPlayers, players: [] },
          );
          await gameStateManager?.addPlayer(payload.worldId, payload.entityId);
          // Prompt all agents for readiness so phase INIT can progress deterministically
          try {
            const coordinationService = payload.runtime.getService(
              CoordinationService.serviceType,
            ) as CoordinationService;
            await coordinationService?.sendGameEvent(
              {
                gameId: payload.worldId,
                roomId: payload.roomId ?? payload.worldId,
                runtime: payload.runtime,
                source: "house",
                timestamp: Date.now(),
                type: "GAME:ARE_YOU_READY",
                event: { type: "ARE_YOU_READY" },
              },
              "all",
            );
          } catch (e) {
            console.log("🏠 Failed to send ARE_YOU_READY:", e);
          }
        }
        console.log(
          `🏠 House received ENTITY_JOINED event for agent ${payload.entityId}`,
        );
        // Ensure phase system is initialized for this world if not already (handled above)
      },
    ],
    [EventType.MESSAGE_SENT]: [
      async (_payload) => {
        // No-op for now; House may not receive SENT for others
      },
    ],
    [EventType.MESSAGE_RECEIVED]: [
      async (payload) => {
        const coordinationService = payload.runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        const isHouseAuthored =
          payload.message.entityId === payload.runtime.agentId;

        if (isHouseAuthored) {
          const text = payload.message.content?.text || "";
          if (/INTRODUCTION PHASE/i.test(text)) {
            await coordinationService?.sendGameEvent(
              {
                gameId: payload.message.roomId,
                roomId: payload.message.roomId,
                runtime: payload.runtime,
                source: "house",
                timestamp: Date.now(),
                type: "GAME:PHASE_STARTED",
                event: {
                  type: "PHASE_STARTED",
                  phase: Phase.INTRODUCTION,
                },
              },
              "others",
            );
          }
          if (/Diary Question for/i.test(text)) {
            const match = text.match(/@([^\s]+)/);
            const targetAgentName = match?.[1];
            if (targetAgentName) {
              await coordinationService?.sendGameEvent(
                {
                  gameId: payload.message.roomId,
                  roomId: payload.message.roomId,
                  runtime: payload.runtime,
                  source: "house",
                  timestamp: Date.now(),
                  type: "GAME:DIARY_PROMPT",
                  event: { type: "DIARY_PROMPT", targetAgentName },
                },
                "others",
              );
            }
          }
        } else if (payload.message.id) {
          // Forward player messages as structured game events
          await coordinationService?.sendGameEvent(
            {
              gameId: payload.message.roomId,
              roomId: payload.message.roomId,
              runtime: payload.runtime,
              source: "house",
              timestamp: Date.now(),
              type: "GAME:MESSAGE_SENT",
              event: {
                type: "MESSAGE_SENT",
                messageId: payload.message.id,
                playerId: payload.message.entityId,
              },
            },
            "others",
          );
        }
      },
    ],
    // Listen for coordination PHASE_STARTED events and react when the WHISPER phase begins
    ["GAME:PHASE_STARTED"]: [
      async (payload) => {
        const action = payload.event;
        if (action?.phase === Phase.WHISPER) {
          const coordinationService = payload.runtime.getService(
            CoordinationService.serviceType,
          ) as CoordinationService;

          if (!coordinationService) {
            throw new Error("CoordinationService not available");
          }

          // Broadcast a WHISPER_PHASE_STARTED event so players/providers can prepare
          await coordinationService.sendGameEvent(
            {
              gameId: payload.gameId,
              roomId: payload.roomId ?? payload.gameId,
              runtime: payload.runtime,
              source: "house",
              timestamp: Date.now(),
              type: "GAME:WHISPER_PHASE_STARTED",
              event: { type: "WHISPER_PHASE_STARTED" },
            },
            "all",
          );
        }
      },
    ],
  } as GameEventHandlers,
  init: async (config, runtime: IAgentRuntime) => {},
};
