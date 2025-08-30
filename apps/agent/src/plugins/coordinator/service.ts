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
  GameEventCoordinationMessage,
  AnyCoordinationMessage,
} from "./types";
import { Phase } from "@/game/types";
import internalMessageBus, { gameEvent$, messages$ } from "./bus";
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
      gameEvent$.subscribe(async (message) => {
        const { targetAgents } = message;

        const targeted =
          targetAgents === "all" ||
          (targetAgents === "others" &&
            message.sourceAgent !== runtime.agentId) ||
          (Array.isArray(targetAgents) &&
            targetAgents.includes(runtime.agentId));

        if (!targeted) return;

        // Emit into the local runtime so plugins can react via `events`.
        // Prefix with "GAME:" to match plugin event keys (e.g., "GAME:ARE_YOU_READY").
        console.log(
          `[CoordinationService] Emitting runtime event ${message.type} for ${runtime.character?.name}`,
        );
        await runtime.emitEvent(message.type, {
          ...message.payload,
          runtime,
        });

        logger.debug(
          `${runtime.character?.name} processed coordination event: ${message.type}`,
        );
      }),
    );

    // DISABLED DUE TO FIRING OFF ALL_PLAYERS_READY events all the time
    //   // Future: subscribe to additional coordination streams as needed
    //   service.subscriptions.push(
    //     messages$.subscribe(async (message) => {
    //       try {
    //         // Only the House translates its own prompts into phase coordination
    //         if (
    //           getAgentRole(runtime) !== AgentRole.HOUSE ||
    //           message.author_id !== runtime.agentId
    //         ) {
    //           return;
    //         }
    //         const channelId = message.channel_id as UUID;
    //         if (service.announcedIntroReady.has(channelId)) return;
    //         service.announcedIntroReady.add(channelId);
    //         await service.sendGameEvent(
    //           {
    //             gameId: channelId,
    //             roomId: channelId,
    //             runtime,
    //             source: "house",
    //             timestamp: message.created_at,
    //             action: {
    //               type: "ALL_PLAYERS_READY",
    //             },
    //           },
    //           "others"
    //         );
    //       } catch (err) {
    //         logger.warn("Failed to announce ALL_PLAYERS_READY from message", err);
    //       }
    //     })
    //   );
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
    if (!("event" in payload || "emitted" in payload)) {
      return;
    }
    if (!canSendMessage(this.runtime, "game_event", payload.type)) {
      throw new Error(
        `Agent ${this.runtime.character?.name} is not authorized to send game event: ${payload.type}`,
      );
    }
    const coordinationMessage = createGameEventMessage(
      this.runtime.agentId,
      payload,
      targetAgents,
    );

    await this.sendCoordinationMessage(coordinationMessage);
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
