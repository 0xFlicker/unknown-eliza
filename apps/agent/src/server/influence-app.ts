import {
  ChannelType,
  createUniqueUuid,
  IAgentRuntime,
  Memory,
  UUID,
} from "@elizaos/core";
import { AgentServer, internalMessageBus } from "@elizaos/server";
import { AppServerConfig, ParticipantMode, RuntimeDecorator } from "./types";
import EventEmitter from "node:events";
import { createAgentServer } from "./factory";
import { AgentManager } from "./agent-manager";
import { ChannelManager } from "./channel-manager";
import { AssociationManager } from "./association-manager";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export class InfluenceApp<
  AgentContext extends Record<string, unknown>,
  AppContext extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private server: AgentServer;
  private serverMetadata: AppContext;
  private serverPort: number;
  private bus: EventEmitter;

  // Production-ready managers
  private associationManager: AssociationManager;
  private agentManager: AgentManager<AgentContext>;
  private channelManager: ChannelManager;

  private defaultRuntimeDecorators: RuntimeDecorator<Runtime>[] = [];

  constructor(private config: AppServerConfig<AppContext, Runtime>) {
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
    this.serverMetadata = server.metadata as AppContext;
    this.serverPort = serverPort;

    // Initialize production managers
    this.associationManager = new AssociationManager();
    this.agentManager = new AgentManager<AgentContext>(
      this.server,
      {
        DATABASE_PATH:
          this.config.dataDir ??
          (() => {
            const dataDir = fs.mkdtempSync(
              path.join(os.tmpdir(), "influence-app-data")
            );
            return dataDir;
          })(),
        ...this.config.runtimeConfig?.runtimeSettings,
      },
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
  getAgentManager(): AgentManager<AgentContext> {
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
  async addAgent(
    config: Parameters<AgentManager<AgentContext>["addAgent"]>[0]
  ) {
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

  async sendMessage(channelId: UUID, agentId: UUID, content: string) {
    const fromRuntime = this.agentManager.getAgentRuntime(agentId);
    if (!fromRuntime) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const channel = this.channelManager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Check if sender can send to this channel
    const senderMode = channel.participants.get(agentId);
    if (!senderMode) {
      throw new Error(
        `Agent ${agentId} is not a participant in channel ${channel.name}`
      );
    }
    if (senderMode.mode === ParticipantMode.OBSERVE_ONLY) {
      throw new Error(
        `Agent ${agentId} is observe-only in channel ${channel.name}`
      );
    }

    // 1. Create memory for the sender (since they won't get it via HTTP POST)
    const roomId = createUniqueUuid(fromRuntime, channelId);
    const authorEntityId = createUniqueUuid(fromRuntime, agentId);

    const senderMemory: Memory = {
      entityId: authorEntityId,
      agentId: fromRuntime.agentId,
      roomId: roomId,
      content: {
        text: content,
        source: "InfluenceApp",
        channelType: channel.type,
      },
      metadata: {
        entityName: fromRuntime.agentId,
        fromId: agentId,
        type: "message",
      },
      createdAt: Date.now(),
    };

    await fromRuntime.createMemory(senderMemory, "messages");
    // 2. HTTP POST to all participants (except sender)
    const baseUrl = `http://localhost:${this.config.serverPort}`;

    const payloadToServer = {
      channel_id: channelId,
      server_id: this.serverMetadata.serverId,
      author_id: agentId, // Use the original author's ID
      content: content,
      in_reply_to_message_id: undefined,
      source_type: "agent_response",
      raw_message: {
        text: content,
      },
      metadata: {
        agent_id: agentId,
        agentName: fromRuntime.character.name,
        entityName: fromRuntime.character.name,
        attachments: [],
        channelType: channel.type,
        isDm: channel.type === ChannelType.DM,
      },
    };

    try {
      await fetch(`${baseUrl}/api/messaging/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadToServer),
      });
    } catch (error) {
      console.error(`Failed to post message to ${fromRuntime.agentId}:`, error);
    }
  }
}
