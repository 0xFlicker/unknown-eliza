import {
  type IAgentRuntime,
  type UUID,
  Service,
  elizaLogger,
  Memory,
  stringToUuid,
  EventType,
} from "@elizaos/core";
import {
  createGameEventMessage,
  createAgentReadyMessage,
  type AnyCoordinationMessage,
} from "./types";
import internalMessageBus from "./bus";
import { canSendMessage } from "./roles";
import { AgentServer } from "@elizaos/server";
import { GameEventPayloadMap } from "src/house/events/types";

const logger = elizaLogger.child({ component: "CoordinationService" });

/**
 * Service for sending and managing coordination messages between agents
 * Uses the existing AgentServer message bus via the coordination channel
 */
export class CoordinationService extends Service {
  static serviceType = "coordination";
  capabilityDescription = "Cross-agent coordination via message bus";

  private isInitialized = false;
  private coordinationChannelId?: UUID;
  private agentServer?: AgentServer; // AgentServer instance for cross-agent messaging

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
    // Channel ID will be set via setCoordinationChannelId()
  }

  /**
   * Initialize the service with runtime
   */
  async initialize(runtime: IAgentRuntime): Promise<void> {
    if (this.isInitialized) {
      logger.warn("CoordinationService already initialized");
      return;
    }

    this.runtime = runtime;
    this.isInitialized = true;

    logger.info(
      `CoordinationService initialized for ${runtime.character?.name}`
    );
  }

  /**
   * Set the coordination channel ID (must be called after initialization)
   */
  setCoordinationChannelId(channelId: UUID): void {
    this.coordinationChannelId = channelId;
    logger.info(`Coordination channel ID set to: ${channelId}`);
  }

  getCoordinationChannelId(): UUID {
    return this.coordinationChannelId;
  }

  /**
   * Set the AgentServer instance for cross-agent messaging
   */
  setAgentServer(agentServer: AgentServer): void {
    this.agentServer = agentServer;
    logger.info(`AgentServer instance set for coordination service`);
  }

  /**
   * Create and start the service
   */
  static async start(runtime: IAgentRuntime): Promise<CoordinationService> {
    const service = new CoordinationService(runtime);
    await service.initialize(runtime);
    runtime.registerService(CoordinationService);
    return service;
  }

  /**
   * Stop the service (required by Service interface)
   */
  async stop(): Promise<void> {
    this.isInitialized = false;
    logger.info("CoordinationService stopped");
  }

  static async registerSendHandlers(
    runtime: IAgentRuntime,
    serviceInstance: CoordinationService
  ) {
    if (serviceInstance) {
      runtime.registerSendHandler(
        "coordination",
        serviceInstance.handleSendMessage.bind(serviceInstance)
      );
      logger.info("[CoordinationService] Registered send handler.");
    }
  }

  handleSendMessage(message: AnyCoordinationMessage): void {
    logger.info("[CoordinationService] Received coordination message", {
      message,
    });
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
    try {
      if (!this.coordinationChannelId) {
        throw new Error("Coordination channel ID not set");
      }

      // Use the configured coordination channel ID
      const channelId = this.coordinationChannelId;

      logger.debug(`🔗 Sending coordination message to channel ${channelId}`, {
        messageType: message.type,
        messageId: message.messageId,
        targetAgents: message.targetAgents,
      });

      // Use AgentServer's createMessage for cross-agent communication
      const serializedMessage = JSON.stringify(message);

      // Send via the coordination channel
      await this.runtime.sendMessageToTarget(
        {
          roomId: this.coordinationChannelId,
          channelId: this.coordinationChannelId,
          source: "coordination",
        },
        {
          text: serializedMessage,
          source: this.runtime.agentId,
          action: "coordination",
        }
      );
      logger.info("🔗 Coordination message sent via AgentServer message bus", {
        messageId: message.messageId,
        channelId: channelId,
        messageType: message.type,
      });
    } catch (error) {
      logger.error("Failed to send coordination message:", error);
      throw error;
    }
  }
}
