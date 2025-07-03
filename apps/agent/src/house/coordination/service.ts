import {
  type IAgentRuntime,
  type UUID,
  Service,
  elizaLogger,
  Memory,
} from "@elizaos/core";
import {
  COORDINATION_CHANNEL_ID,
  createGameEventMessage,
  createAgentReadyMessage,
  type AnyCoordinationMessage,
  type GameEventCoordinationMessage,
  type AgentReadyCoordinationMessage,
} from "./types";
import {
  GameEventType,
  GameEventPayloadMap,
  PlayerReadyPayload,
} from "../events/types";
import { createSyntheticMessage } from "./action";
import { PhaseCoordinator } from "../services/phaseCoordinator";

const logger = elizaLogger.child({ component: "CoordinationService" });

/**
 * Service for sending and managing coordination messages between agents
 * Uses the existing AgentServer message bus via the coordination channel
 */
export class CoordinationService extends Service {
  static serviceType = "coordination";
  capabilityDescription = "Cross-agent coordination via message bus";

  private isInitialized = false;

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
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
      "CoordinationService initialized for cross-agent communication"
    );
  }

  /**
   * Static method to start the service (follows ElizaOS service pattern)
   */
  static async start(runtime: IAgentRuntime): Promise<CoordinationService> {
    const service = new CoordinationService(runtime);
    await service.initialize(runtime);

    // Register service with runtime
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

  /**
   * Send a game event to other agents via coordination channel
   */
  async sendGameEvent<T extends keyof GameEventPayloadMap>(
    gameEventType: T,
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[] | "all" | "others" = "others"
  ): Promise<void> {
    try {
      const coordinationMessage = createGameEventMessage(
        this.runtime.agentId,
        gameEventType,
        payload,
        targetAgents
      );

      await this.sendCoordinationMessage(coordinationMessage);

      logger.info(`Sent game event: ${gameEventType}`, {
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
    readyType: "strategic_thinking" | "diary_room" | "phase_action",
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
   * Send any coordination message via the coordination channel
   */
  async sendCoordinationMessage(
    message: AnyCoordinationMessage
  ): Promise<void> {
    try {
      // Serialize the coordination message
      const serializedMessage = JSON.stringify(message);

      // Send via the coordination channel
      await this.runtime.sendMessageToTarget(
        {
          roomId: COORDINATION_CHANNEL_ID,
          channelId: COORDINATION_CHANNEL_ID,
          source: "coordination",
        },
        {
          text: serializedMessage,
          source: this.runtime.agentId,
          action: "coordination",
        }
      );

      logger.debug("Coordination message sent", {
        messageType: message.type,
        messageId: message.messageId,
        targetAgents: message.targetAgents,
      });
    } catch (error) {
      logger.error("Failed to send coordination message:", error);
      throw error;
    }
  }

  /**
   * Convenience method to broadcast a game event to all other agents
   */
  async broadcastGameEvent<T extends keyof GameEventPayloadMap>(
    gameEventType: T,
    payload: GameEventPayloadMap[T]
  ): Promise<void> {
    return this.sendGameEvent(gameEventType, payload, "others");
  }

  /**
   * Convenience method to send a game event to specific agents
   */
  async sendGameEventToAgents<T extends keyof GameEventPayloadMap>(
    gameEventType: T,
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[]
  ): Promise<void> {
    return this.sendGameEvent(gameEventType, payload, targetAgents);
  }

  /**
   * Get the coordination channel ID (for testing and debugging)
   */
  getCoordinationChannelId(): UUID {
    return COORDINATION_CHANNEL_ID;
  }

  /**
   * Check if the service is properly initialized
   */
  isReady(): boolean {
    return this.isInitialized && !!this.runtime;
  }

  /**
   * Handle game event coordination messages
   */
  async handleGameEvent(
    runtime: IAgentRuntime,
    message: GameEventCoordinationMessage
  ): Promise<boolean> {
    try {
      const { gameEventType, payload } = message;

      logger.info(
        `Handling game event: ${gameEventType} for ${runtime.character?.name}`,
        {
          sourceAgent: message.sourceAgent,
          gameEventType,
        }
      );

      // Emit the game event locally in this agent's runtime for any event handlers
      await runtime.emitEvent(gameEventType, payload);

      // Special handling for specific game events that need to trigger actions
      switch (gameEventType) {
        case GameEventType.STRATEGIC_THINKING_REQUIRED:
          logger.debug(
            `Strategic thinking required for ${runtime.character?.name}`
          );
          // Create a synthetic message to trigger the phaseTransitionThinkingAction
          await createSyntheticMessage(runtime, gameEventType, payload);
          break;

        case GameEventType.PHASE_TRANSITION_INITIATED:
          logger.debug(
            `Phase transition initiated for ${runtime.character?.name}`
          );
          // Local event handlers will process this
          break;

        case GameEventType.PHASE_STARTED:
          logger.debug(`Phase started for ${runtime.character?.name}`);
          // Create a synthetic message to trigger actions like introductionResponseAction
          await createSyntheticMessage(runtime, gameEventType, payload);
          break;

        case GameEventType.I_AM_READY:
          logger.debug(
            `I_AM_READY signal received for ${runtime.character?.name}`
          );
          // Route to PhaseCoordinator if this is a House agent
          if (runtime.character?.name?.toLowerCase().includes("house")) {
            const coordinator = runtime.getService<PhaseCoordinator>(
              PhaseCoordinator.serviceType
            );
            if (coordinator) {
              await coordinator.handleIAmReadyEvent(
                payload as PlayerReadyPayload
              );
            }
          }
          break;

        default:
          logger.debug(`Generic game event handled: ${gameEventType}`);
      }

      return true;
    } catch (error) {
      logger.error("Error handling game event coordination message:", error);
      return false;
    }
  }

  /**
   * Handle agent ready coordination messages
   */
  async handleAgentReady(
    runtime: IAgentRuntime,
    message: AgentReadyCoordinationMessage
  ): Promise<boolean> {
    try {
      const { payload } = message;

      logger.info(
        `Agent ready signal received: ${payload.playerName} for ${payload.readyType}`,
        {
          sourceAgent: message.sourceAgent,
          readyType: payload.readyType,
          gameId: payload.gameId,
        }
      );

      // Emit local event for this agent ready signal
      await runtime.emitEvent(GameEventType.PLAYER_READY, payload);

      return true;
    } catch (error) {
      logger.error("Error handling agent ready coordination message:", error);
      return false;
    }
  }
}
