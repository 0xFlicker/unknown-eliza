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
import { PhaseCoordinator } from "./services/phaseCoordinator";
import {
  AnyCoordinationMessage,
  COORDINATION_CHANNEL_ID,
  CoordinationService,
  handleAgentReady,
  handleCoordinationAck,
  handleGameEvent,
  handleHeartbeat,
  isCoordinationMessage,
} from "./coordination";
import {
  GameEventType,
  GameEventHandler,
  GameEventPayloadMap,
} from "./events/types";
import { MessageEvent } from "node:http";

const logger = elizaLogger.child({ component: "HousePlugin" });

/**
 * Utility type for properly typed game event handlers in plugins
 */
type GameEventHandlers = Plugin["events"] & {
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
  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async ({ message, runtime }) => {
        // Only process messages from the coordination channel
        if (message.roomId !== COORDINATION_CHANNEL_ID) {
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
              logger.debug(
                `Coordination message validation passed for ${runtime.character?.name}`,
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
                case "game_event":
                  await handleGameEvent(runtime, coordinationMessage);
                  return;

                case "agent_ready":
                  await handleAgentReady(runtime, coordinationMessage);
                  return;

                case "heartbeat":
                  await handleHeartbeat(runtime, coordinationMessage);
                  return;

                case "coordination_ack":
                  await handleCoordinationAck(runtime, coordinationMessage);
                  return;

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
  },
  evaluators: [phaseTimerEvaluator],
  services: [PhaseCoordinator, CoordinationService],
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      // Initialize the phase coordinator service
      await PhaseCoordinator.start(runtime);

      // Initialize the coordination service
      await CoordinationService.start(runtime);

      logger.info(
        "🏠 House plugin initialized with cross-agent coordination - ready to moderate Influence games"
      );
    } else {
      logger.info(
        "🏠 House plugin initialized - ready to moderate Influence games"
      );
    }
  },
};
