import { createUniqueUuid, IAgentRuntime } from "@elizaos/core";
import { AgentServer, internalMessageBus } from "@elizaos/server";
import { AppServerConfig, RuntimeDecorator } from "./types";
import EventEmitter from "node:events";
import { createAgentServer } from "./factory";
import { AgentManager } from "./agent-manager";
import { ChannelManager } from "./channel-manager";
import { AssociationManager } from "./association-manager";

export class InfluenceApp<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private server: AgentServer;
  private serverMetadata: Context;
  private serverPort: number;
  private bus: EventEmitter;

  // Production-ready managers
  private associationManager: AssociationManager;
  private agentManager: AgentManager;
  private channelManager: ChannelManager;

  private defaultRuntimeDecorators: RuntimeDecorator<Runtime>[] = [];

  constructor(private config: AppServerConfig<Context, Runtime>) {
    this.bus = internalMessageBus;
    if (config.runtimeConfig?.runtime) {
      this.defaultRuntimeDecorators.push(config.runtimeConfig?.runtime);
    }
    for (const plugin of config.runtimeConfig?.defaultPlugins || []) {
      this.defaultRuntimeDecorators.push((runtime) => {
        runtime.registerPlugin(plugin);
        return runtime as Runtime;
      });
    }
  }

  async initialize() {
    const { server, agentServer, serverPort } = await createAgentServer(
      this.config
    );
    this.server = agentServer;
    this.serverMetadata = server.metadata as Context;
    this.serverPort = serverPort;

    // Initialize production managers
    this.associationManager = new AssociationManager();
    this.agentManager = new AgentManager(
      this.server,
      this.defaultRuntimeDecorators
    );
    this.channelManager = new ChannelManager(
      this.server,
      server,
      this.associationManager,
      this.agentManager
    );
  }

  async start() {
    this.server.start(this.serverPort);
  }

  async stop() {
    // Clean up managers
    await this.channelManager.cleanup();
    await this.agentManager.cleanup();

    // Stop server
    await this.server.stop();
  }

  // Agent management methods
  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  // Channel management methods
  getChannelManager(): ChannelManager {
    return this.channelManager;
  }

  // Association management methods
  getAssociationManager(): AssociationManager {
    return this.associationManager;
  }

  // Convenience methods for common operations
  async addAgent(config: Parameters<AgentManager["addAgent"]>[0]) {
    return this.agentManager.addAgent(config);
  }

  async createChannel(config: Parameters<ChannelManager["createChannel"]>[0]) {
    return this.channelManager.createChannel(config);
  }

  // Get statistics
  getStats() {
    return {
      agents: this.agentManager.getStats(),
      channels: this.channelManager.getStats(),
      associations: this.associationManager.getStats(),
    };
  }
}
