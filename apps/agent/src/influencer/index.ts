import {
  EventHandler,
  EventPayload,
  EventPayloadMap,
  Plugin,
  PluginEvents,
  elizaLogger,
  EventType,
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
  GameEventHandlers,
} from "../house/events/types";
import { Phase } from "../house/types";
import {
  CoordinationService,
  isCoordinationMessage,
  type AnyCoordinationMessage,
} from "../coordinator";

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
    [EventType.MESSAGE_RECEIVED]: [
      async ({ message, runtime }) => {
        const coordinationService = runtime.getService<CoordinationService>(
          CoordinationService.serviceType
        );
        if (!coordinationService) {
          return;
        }
        const coordinationChannelId =
          coordinationService.getCoordinationChannelId();
        // Only process messages from the coordination channel
        if (message.roomId !== coordinationChannelId) {
          return;
        }

        // Don't process messages from ourselves
        if (message.content.source === runtime.agentId) {
          return;
        }

        // Must have text content
        if (!message.content.text) {
          return;
        }

        // Try to parse as coordination message
        try {
          const parsed = JSON.parse(message.content.text);
          const isValid = isCoordinationMessage(parsed);

          if (isValid) {
            // Check if this message is targeted to us
            const msg = parsed as AnyCoordinationMessage;
            const isTargeted =
              msg.targetAgents === "all" ||
              msg.targetAgents === "others" ||
              (Array.isArray(msg.targetAgents) &&
                msg.targetAgents.includes(runtime.agentId));

            if (isTargeted) {
              console.log(
                `🎭 Influencer ${runtime.character?.name} received coordination message:`,
                {
                  messageType: msg.type,
                  sourceAgent: msg.sourceAgent,
                  targetAgents: msg.targetAgents,
                }
              );

              const coordinationMessage = JSON.parse(
                message.content.text!
              ) as AnyCoordinationMessage;

              // Route to appropriate handler based on message type
              switch (coordinationMessage.type) {
                // case "game_event":
                //   await handleGameEvent(runtime, coordinationMessage);
                //   return;

                // case "agent_ready":
                //   await handleAgentReady(runtime, coordinationMessage);
                //   return;

                // case "heartbeat":
                //   await handleHeartbeat(runtime, coordinationMessage);
                //   return;

                // case "coordination_ack":
                //   await handleCoordinationAck(runtime, coordinationMessage);
                //   return;

                default:
                  logger.warn(
                    `Unknown coordination message type: ${(coordinationMessage as AnyCoordinationMessage).type}`
                  );
                  return;
              }
            }
          }
        } catch (error) {
          // Not a valid JSON coordination message
          return;
        }
      },
    ],
    [GameEventType.PHASE_STARTED]: [
      async ({ runtime, phase, gameId, roomId }) => {
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
            gameId,
            roomId,
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
    [GameEventType.DIARY_ROOM_OPENED]: [
      async ({ runtime, gameId, roomId }) => {
        logger.info(`Diary room opened for ${runtime.character?.name}`, {
          gameId,
          roomId,
        });

        // The coordination system will create a synthetic message
        // that should trigger the diary room action
      },
    ],
  } as GameEventHandlers, // seems to be required as far as I can tell
};
