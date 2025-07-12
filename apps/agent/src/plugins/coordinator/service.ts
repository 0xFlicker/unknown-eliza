import {
  type IAgentRuntime,
  type UUID,
  Service,
  elizaLogger,
  Memory,
  stringToUuid,
  EventType,
  SendHandlerFunction,
} from "@elizaos/core";
import {
  createGameEventMessage,
  createAgentReadyMessage,
  type AnyCoordinationMessage,
} from "./types";
import internalMessageBus from "./bus";
import { canSendMessage } from "./roles";
import { AgentServer } from "@elizaos/server";
import { GameEventPayloadMap } from "src/plugins/house/events/types";

const logger = elizaLogger.child({ component: "CoordinationService" });

/**
 * Service for sending and managing coordination messages between agents
 * Uses the existing AgentServer message bus via the coordination channel
 */
export class CoordinationService extends Service {
  static serviceType = "coordination";
  capabilityDescription = "Cross-agent coordination via message bus";

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
  }
  /**
   * Create and start the service
   */
  static async start(runtime: IAgentRuntime): Promise<CoordinationService> {
    const service = new CoordinationService(runtime);
    return service;
  }

  /**
   * Stop the service (required by Service interface)
   */
  async stop(): Promise<void> {
    logger.info("CoordinationService stopped");
  }

  /**
   * Send a game event to other agents via coordination channel
   */
  async sendGameEvent<T extends keyof GameEventPayloadMap>(
    gameEventType: T,
    payload: Omit<GameEventPayloadMap[T], "runtime" | "onComplete">,
    targetAgents: UUID[] | "all" | "others" = "others"
  ): Promise<void> {
    if (!canSendMessage(this.runtime, "game_event", gameEventType)) {
      throw new Error(
        `Agent ${this.runtime.character?.name} is not authorized to send game event: ${gameEventType}`
      );
    }

    try {
      logger.info(
        `🔗 Sending game event ${gameEventType} from ${this.runtime.character?.name} to ${targetAgents}`
      );

      const coordinationMessage = createGameEventMessage(
        this.runtime.agentId,
        gameEventType,
        payload,
        targetAgents
      );

      await this.sendCoordinationMessage(coordinationMessage);

      logger.info(`Game event ${gameEventType} sent successfully`, {
        targetAgents,
        messageId: coordinationMessage.messageId,
      });
    } catch (error) {
      logger.error(`Failed to send game event: ${gameEventType}`, error);
      throw error;
    }
  }

  /**
   * Send an agent ready signal via coordination channel
   */
  async sendAgentReady(
    readyType: string,
    gameId: UUID,
    roomId: UUID,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    try {
      const readyData = {
        readyType,
        gameId,
        roomId,
        playerId: this.runtime.agentId,
        playerName: this.runtime.character?.name || "Unknown Agent",
        additionalData,
      };

      const coordinationMessage = createAgentReadyMessage(
        this.runtime.agentId,
        readyData
      );

      await this.sendCoordinationMessage(coordinationMessage);

      logger.info(`Sent agent ready signal: ${readyType}`, {
        gameId,
        roomId,
        messageId: coordinationMessage.messageId,
      });
    } catch (error) {
      logger.error(`Failed to send agent ready signal: ${readyType}`, error);
      throw error;
    }
  }

  /**
   * Send a coordination message to the coordination channel
   */
  private async sendCoordinationMessage(
    message: AnyCoordinationMessage
  ): Promise<void> {
    internalMessageBus.emit(message.type, message);
  }
}
