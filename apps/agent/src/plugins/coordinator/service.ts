import {
  type IAgentRuntime,
  type UUID,
  Service,
  elizaLogger,
} from "@elizaos/core";
import {
  createGameEventMessage,
  createAgentReadyMessage,
  type AnyCoordinationMessage,
  type AnyGameEventCoordinationMessage,
} from "./types";
import internalMessageBus, { gameEvent$ } from "./bus";
import { canSendMessage } from "./roles";
import { GameEventPayloadMap } from "../house/events/types";
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
    // TEMP: quick debug output to ensure service starts during tests
    console.log(
      `[CoordinationService] start for ${runtime.character?.name} (${runtime.agentId})`,
    );

    const service = new CoordinationService(runtime);

    // DEBUG: log all incoming game_event traffic once per runtime
    internalMessageBus.on("game_event", (m: any) => {
      console.log(
        `[Bus] (${runtime.character?.name}) saw game_event ${m.gameEventType} from ${m.sourceAgent} to ${m.targetAgents}`,
      );
    });

    // Subscribe to incoming coordination game events
    service.subscriptions.push(
      gameEvent$.subscribe(async (message: AnyGameEventCoordinationMessage) => {
        console.log(
          `[CoordinationService] ${runtime.character?.name} heard ${message.gameEventType} target=${message.targetAgents}`,
        );
        const { targetAgents } = message;

        const targeted =
          targetAgents === "all" ||
          (targetAgents === "others" &&
            message.sourceAgent !== runtime.agentId) ||
          (Array.isArray(targetAgents) &&
            targetAgents.includes(runtime.agentId));

        if (!targeted) return;

        // Emit into the local runtime so plugins can react via `events`
        await runtime.emitEvent(message.gameEventType, {
          ...message.payload,
          runtime,
          source: message.sourceAgent,
        });

        logger.debug(
          `${runtime.character?.name} processed coordination event: ${message.gameEventType}`,
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
    gameEventType: T,
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[] | "all" | "others" = "others",
  ): Promise<void> {
    if (!canSendMessage(this.runtime, "game_event", gameEventType)) {
      throw new Error(
        `Agent ${this.runtime.character?.name} is not authorized to send game event: ${gameEventType}`,
      );
    }

    try {
      logger.debug(
        `Sending game event ${gameEventType} from ${this.runtime.character?.name} to ${targetAgents}`,
      );
      console.log(
        `[CoordinationService] ${this.runtime.character?.name} sending ${gameEventType}`,
      );

      const coordinationMessage = createGameEventMessage(
        this.runtime.agentId,
        gameEventType,
        payload,
        targetAgents,
      );

      await this.sendCoordinationMessage(
        coordinationMessage as AnyCoordinationMessage,
      );

      // Also emit directly into this runtime so that any local listeners
      // (and the InfluenceApp hook that forwards runtime.emitEvent into the
      // global game-event stream) pick it up without relying on the bus.
      await this.runtime.emitEvent(gameEventType, {
        ...payload,
        source: this.runtime.agentId,
      });

      logger.debug(`Game event ${gameEventType} sent successfully`, {
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
    additionalData?: Record<string, unknown>,
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
        readyData,
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
    internalMessageBus.emit(message.type, message);
  }
}
