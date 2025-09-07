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
  GameEventPayloadEmittableMap,
  createGameEmitMessage,
  EmittableGameEventMessages,
  GameEventMessages,
} from "./types";
import internalMessageBus, { gameAction$, gameEvent$ } from "./bus";
import { AgentRole, canSendMessage, getAgentRole } from "./roles";
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
      gameAction$.subscribe(async (message) => {
        const { targetAgents } = message;
        if (
          targetAgents === "house" &&
          getAgentRole(runtime) !== AgentRole.HOUSE
        ) {
          // Send to the house only, ignore
          await runtime.emitEvent(message.type, {
            ...message.payload,
            runtime,
          });
          return;
        }

        const targeted =
          targetAgents === "all" ||
          (targetAgents === "others" &&
            message.sourceAgent !== runtime.agentId) ||
          (Array.isArray(targetAgents) &&
            targetAgents.includes(runtime.agentId));

        if (!targeted) return;

        await runtime.emitEvent(message.type, {
          ...message.payload,
          runtime,
        });
      }),
      gameEvent$.subscribe(async (message) => {
        const { targetAgents } = message;
        if (
          targetAgents === "house" &&
          getAgentRole(runtime) !== AgentRole.HOUSE
        ) {
          // Send to the house only, ignore
          await runtime.emitEvent(message.type, {
            ...message.payload,
            runtime,
          });
          return;
        }

        const targeted =
          targetAgents === "all" ||
          (targetAgents === "others" &&
            message.sourceAgent !== runtime.agentId) ||
          (Array.isArray(targetAgents) &&
            targetAgents.includes(runtime.agentId));

        if (!targeted) return;

        await runtime.emitEvent(message.type, {
          ...message.payload,
          runtime,
        });
      }),
    );
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
  sendGameEvent<T extends keyof GameEventPayloadMap>(
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[] | "all" | "house" | "others" = "others",
  ): void {
    if (!("event" in payload)) {
      console.warn(
        "CoordinationService.sendGameEvent called with payload missing 'event' property",
        payload,
      );
      return;
    }
    if (!canSendMessage(this.runtime, "game_action", payload.type)) {
      throw new Error(
        `Agent ${this.runtime.character?.name} is not authorized to send game action: ${payload.type}`,
      );
    }
    console.log(`🏠 Sending game event: ${payload.type} to ${targetAgents}`);
    const coordinationMessage = createGameEventMessage(
      this.runtime.agentId,
      payload,
      targetAgents,
    );

    this.sendCoordinationMessage(coordinationMessage);
  }

  emitGameEvent<T extends keyof GameEventPayloadEmittableMap>(
    payload: GameEventPayloadEmittableMap[T],
    targetAgents: UUID[] | "all" | "others" = "others",
  ): void {
    const coordinationMessage = createGameEmitMessage(
      this.runtime.agentId,
      payload,
      targetAgents,
    );

    // console.log(`🏠 Emitting game event: ${payload.type} to ${targetAgents}`);

    this.sendStateEvent(coordinationMessage);
  }

  /**
   * Send a coordination message to the coordination channel
   */
  private sendCoordinationMessage(message: GameEventMessages): void {
    internalMessageBus.emit("game_action", message);
  }

  private sendStateEvent(message: EmittableGameEventMessages): void {
    internalMessageBus.emit("game_event", message);
  }
}
