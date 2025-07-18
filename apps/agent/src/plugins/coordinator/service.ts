import {
  type IAgentRuntime,
  type UUID,
  Service,
  elizaLogger,
} from "@elizaos/core";
import {
  createGameEventMessage,
  createAgentReadyMessage,
  GameEventPayloadMap,
  GameEventType,
  GameEventCoordinationMessage,
  AnyCoordinationMessage,
} from "./types";
import { Phase } from "@/memory/types";
import internalMessageBus, { gameEvent$ } from "./bus";
import { canSendMessage } from "./roles";
import { Subscription } from "rxjs";

const logger = elizaLogger.child({ component: "CoordinationService" });

/**
 * Service for sending and managing coordination messages between agents
 * Uses the existing AgentServer message bus via the coordination channel
 */
export class CoordinationService extends Service {
  static serviceType = "coordination";
  capabilityDescription = "Cross-agent coordination via message bus";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.subscriptions = [];
  }

  private subscriptions: Subscription[];
  /**
   * Create and start the service
   */
  static async start(runtime: IAgentRuntime): Promise<CoordinationService> {
    logger.info(
      `Starting CoordinationService for ${runtime.character?.name ?? "unknown"}`,
    );

    const service = new CoordinationService(runtime);

    // Subscribe to incoming coordination game events
    service.subscriptions.push(
      gameEvent$.subscribe(async (message) => {
        const { targetAgents } = message;

        const targeted =
          targetAgents === "all" ||
          (targetAgents === "others" &&
            message.sourceAgent !== runtime.agentId) ||
          (Array.isArray(targetAgents) &&
            targetAgents.includes(runtime.agentId));

        if (!targeted) return;

        // Emit into the local runtime so plugins can react via `events`
        await runtime.emitEvent(message.payload.type, {
          ...message.payload,
          runtime,
        });

        logger.debug(
          `${runtime.character?.name} processed coordination event: ${message.type}`,
        );
      }),
    );

    // Future: subscribe to additional coordination streams as needed
    return service;
  }

  /**
   * Optional static stop to allow runtime to perform graceful shutdowns.
   */
  static async stop(runtime: IAgentRuntime): Promise<void> {
    const svc = runtime.getService<CoordinationService>(
      CoordinationService.serviceType,
    );
    if (svc) {
      await svc.stop();
    }
  }

  /**
   * Stop the service (required by Service interface)
   */
  async stop(): Promise<void> {
    logger.info("CoordinationService stopped");

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
  }

  /**
   * Send a game event to other agents via coordination channel
   */
  async sendGameEvent<T extends keyof GameEventPayloadMap>(
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[] | "all" | "others" = "others",
  ): Promise<void> {
    if (!canSendMessage(this.runtime, "game_event", payload.type)) {
      throw new Error(
        `Agent ${this.runtime.character?.name} is not authorized to send game event: ${payload.type}`,
      );
    }

    logger.debug(
      `Sending game event ${payload.type} from ${this.runtime.character?.name} to ${targetAgents}`,
    );

    const coordinationMessage = createGameEventMessage(
      this.runtime.agentId,
      payload,
      targetAgents,
    );

    await this.sendCoordinationMessage(coordinationMessage);

    logger.debug(`Game event ${payload.type} sent successfully`, {
      targetAgents,
      messageId: coordinationMessage.messageId,
    });
  }

  /**
   * Send an agent ready signal via coordination channel
   */
  async sendAgentReady({
    readyType,
    gameId,
    roomId,
    targetPhase,
  }: {
    readyType: "strategic_thinking" | "diary_room" | "phase_action";
    targetPhase?: Phase;
    gameId: UUID;
    roomId: UUID;
  }): Promise<void> {
    try {
      const coordinationMessage = createAgentReadyMessage(
        this.runtime.agentId,
        {
          readyType,
          gameId,
          roomId,
          targetPhase,
          runtime: this.runtime,
          source: this.runtime.agentId,
          type: GameEventType.ARE_YOU_READY,
          timestamp: Date.now(),
        },
      );

      await this.sendCoordinationMessage(coordinationMessage);

      logger.debug(`Sent agent ready signal: ${readyType}`, {
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
    message: AnyCoordinationMessage,
  ): Promise<void> {
    internalMessageBus.emit("game_event", message);
  }
}
