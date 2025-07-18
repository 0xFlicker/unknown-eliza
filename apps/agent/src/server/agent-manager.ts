import {
  AgentRuntime,
  IAgentRuntime,
  Role,
  RuntimeSettings,
  UUID,
  createUniqueUuid,
  logger,
} from "@elizaos/core";
import { AgentServer, MessageServer } from "@elizaos/server";
import { Agent, AgentConfig, RuntimeDecorator } from "./types";

/**
 * Production-ready agent manager for handling agent lifecycle and runtime decoration
 */
export class AgentManager<Context extends Record<string, unknown>> {
  private agents = new Map<UUID, Agent<Context>>();
  private runtimeDecorators: RuntimeDecorator<IAgentRuntime>[] = [];

  constructor(
    private server: AgentServer,
    private runtimeSettings: RuntimeSettings,
    private messageServer: MessageServer,
    defaultDecorators: RuntimeDecorator<IAgentRuntime>[] = []
  ) {
    this.runtimeDecorators = [...defaultDecorators];
  }

  /**
   * Add a runtime decorator for customizing agent behavior
   */
  addRuntimeDecorator(decorator: RuntimeDecorator<IAgentRuntime>): void {
    this.runtimeDecorators.push(decorator);
  }

  /**
   * Create and add an agent to the system
   */
  async addAgent(config: AgentConfig<Context>): Promise<Agent<Context>> {
    logger.info(`Creating agent with character: ${config.character.name}`);

    // Create the runtime
    const runtime = new AgentRuntime({
      character: config.character,
      plugins: config.plugins || [],
      settings: {
        ...this.runtimeSettings,
      },
    });

    // Apply runtime decorators
    let decoratedRuntime: IAgentRuntime = runtime;
    for (const decorator of this.runtimeDecorators) {
      try {
        const result = await decorator(decoratedRuntime, {});
        decoratedRuntime = result as IAgentRuntime;
        logger.debug(
          `Applied runtime decorator to agent ${config.character.name}`
        );
      } catch (error) {
        logger.error(
          `Failed to apply runtime decorator to agent ${config.character.name}:`,
          error
        );
        throw error;
      }
    }

    // Initialize the runtime
    await decoratedRuntime.initialize();

    // Register with AgentServer
    await this.server.registerAgent(decoratedRuntime);

    // Run agent-specific initialization hook
    if (config.init) {
      await config.init(decoratedRuntime);
      logger.debug(`Ran init hook for agent ${config.character.name}`);
    }

    const worldId = createUniqueUuid(decoratedRuntime, this.messageServer.id);
    let world = await decoratedRuntime.getWorld(worldId);
    if (!world) {
      await decoratedRuntime.createWorld({
        id: worldId,
        name: "Influence",
        agentId: decoratedRuntime.agentId,
        serverId: this.messageServer.id,
        metadata: {
          roles: {
            [decoratedRuntime.agentId]: Role.NONE,
          },
        },
      });
    }

    // Create agent record
    const agent: Agent<Context> = {
      id: decoratedRuntime.agentId,
      runtime: decoratedRuntime,
      character: config.character,
      metadata: config.metadata,
      createdAt: Date.now(),
    };

    // Store agent
    this.agents.set(agent.id, agent);

    logger.info(
      `Successfully created agent ${config.character.name} with ID: ${agent.id}`
    );

    return agent;
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: UUID): Agent<Context> | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get an agent's runtime by ID
   */
  getAgentRuntime(agentId: UUID): IAgentRuntime | undefined {
    const agent = this.agents.get(agentId);
    return agent?.runtime;
  }

  /**
   * Get all agents
   */
  getAllAgents(): Agent<Context>[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all agent IDs
   */
  getAllAgentIds(): UUID[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Remove an agent from the system
   */
  async removeAgent(agentId: UUID): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    logger.info(`Removing agent ${agent.character.name} (${agentId})`);

    try {
      // Stop the runtime
      await agent.runtime.stop();

      // Remove from storage
      this.agents.delete(agentId);

      logger.info(`Successfully removed agent ${agent.character.name}`);
    } catch (error) {
      logger.error(`Failed to remove agent ${agent.character.name}:`, error);
      throw error;
    }
  }

  /**
   * Check if an agent exists
   */
  hasAgent(agentId: UUID): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Get map of agentId => Agent
   */
  getAgentMap(): Map<UUID, Agent<Context>> {
    return this.agents;
  }

  /**
   * Find agent by character name
   */
  findAgentByName(name: string): Agent<Context> | undefined {
    return Array.from(this.agents.values()).find(
      (agent) => agent.character.name === name
    );
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    totalAgents: number;
    agentsByCharacter: Record<string, number>;
    averageCreationTime: number;
  } {
    const agents = Array.from(this.agents.values());
    const agentsByCharacter: Record<string, number> = {};

    let totalCreationTime = 0;

    for (const agent of agents) {
      const characterName = agent.character.name;
      agentsByCharacter[characterName] =
        (agentsByCharacter[characterName] || 0) + 1;
      totalCreationTime += agent.createdAt;
    }

    return {
      totalAgents: agents.length,
      agentsByCharacter,
      averageCreationTime:
        agents.length > 0 ? totalCreationTime / agents.length : 0,
    };
  }

  /**
   * Clean up all agents
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up ${this.agents.size} agents`);

    const cleanupPromises = Array.from(this.agents.keys()).map((agentId) =>
      this.removeAgent(agentId).catch((error) => {
        logger.error(`Failed to cleanup agent ${agentId}:`, error);
      })
    );

    await Promise.all(cleanupPromises);
    this.agents.clear();

    logger.info("Agent cleanup completed");
  }
}
