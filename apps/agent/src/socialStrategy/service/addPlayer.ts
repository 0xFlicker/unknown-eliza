import {
  IAgentRuntime,
  Service,
  elizaLogger,
  stringToUuid,
} from "@elizaos/core";
import { PlayerEntity } from "../types";

const logger = elizaLogger;
const BASE_TRUST = 50;

export class AddPlayerService extends Service {
  static serviceType: string = "social-strategy-add-player";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  capabilityDescription: string =
    "Add a player to memories, so that the agent can track their actions and interactions before they are added to the social graph";

  static async stop(runtime: IAgentRuntime): Promise<unknown> {
    logger.info("*** Stopping starter service ***");
    // get the service from the runtime
    const service = runtime.getService(AddPlayerService.serviceType);
    if (!service) {
      throw new Error("Starter service not found");
    }
    service.stop();
    return void 0;
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    logger.info("*** Starting AddPlayerService ***");
    const service = new AddPlayerService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info("*** Stopping AddPlayerService ***");
    return void 0;
  }

  async getOrCreatePlayer({ handle }: { handle: string }) {
    logger.info("*** Adding player to memories ***");
    const id = stringToUuid(
      `${this.runtime.agentId}:player:${handle.toLowerCase()}`,
    );
    const entity = await this.runtime.getEntityById(id);
    if (entity) {
      return entity as PlayerEntity;
    }
    const now = Date.now();
    const newPlayer: PlayerEntity = {
      id,
      agentId: this.runtime.agentId,
      names: [handle],
      metadata: {
        trustScore: BASE_TRUST,
        firstInteraction: now,
        lastInteraction: now,
        relationshipType: "neutral",
        interactionCount: 1,
      },
    };
    await this.runtime.createEntity(newPlayer);
    return newPlayer;
  }
}
