import {
  AgentRuntime,
  ChannelType,
  IAgentRuntime,
  Role,
  UUID,
  createUniqueUuid,
  logger,
  stringToUuid,
  RuntimeSettings,
} from "@elizaos/core";
import { AgentServer, internalMessageBus } from "@elizaos/server";
import { AppServerConfig, RuntimeDecorator, StreamedMessage } from "./types";
import EventEmitter from "node:events";
import { housePlugin } from "../../src/plugins/house";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { createAgentServer } from "./factory";
import { AgentManager } from "./agent-manager";
import { ChannelManager } from "./channel-manager";
import { AssociationManager } from "./association-manager";
import { SocketIOManager } from "../lib/socketio-manager";
import { Subject, Observable, map, tap } from "rxjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { MessageServer } from "@elizaos/server";
import houseCharacter from "@/characters/house";
import { apiClient } from "@/lib/api";
import { coordinatorPlugin } from "../plugins/coordinator";
import { GameManager, GameConfig } from "./game-manager";

export class InfluenceApp<
  AgentContext extends Record<string, unknown>,
  AppContext extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private server?: AgentServer;
  private messageServer?: MessageServer & { metadata: AppContext };
  private serverPort?: number;
  private bus: EventEmitter;

  // Managers
  private associationManager?: AssociationManager;
  private agentManager?: AgentManager<AgentContext, Runtime>;
  private channelManager?: ChannelManager<AgentContext, Runtime>;
  private gameManager?: GameManager<AgentContext, Runtime>;

  // The house agent
  private houseAgent: IAgentRuntime | null = null;

  // Message streaming infrastructure
  private socketManager?: SocketIOManager;
  private messageStream$ = new Subject<StreamedMessage>();
  private channelMessageStreams = new Map<UUID, Subject<StreamedMessage>>();

  // Runtime configuration
  private defaultRuntimeDecorators: RuntimeDecorator<Runtime>[] = [];

  constructor(private config: AppServerConfig<AppContext, Runtime>) {
    this.bus = internalMessageBus;
    if (config.runtimeConfig?.runtime) {
      this.defaultRuntimeDecorators.push(config.runtimeConfig?.runtime);
    }
    for (const plugin of config.runtimeConfig?.defaultPlugins || []) {
      this.defaultRuntimeDecorators.push((runtime) => {
        runtime.registerPlugin(plugin);
        return runtime;
      });
    }
  }

  async initialize() {
    const { server, agentServer, serverPort } = await createAgentServer(
      this.config,
    );
    process.env.SERVER_PORT = serverPort.toString();
    apiClient.setEndpoint(`http://localhost:${serverPort}/api`);
    const dataDir =
      this.config.dataDir ??
      (() => {
        const dataDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "influence-app-data"),
        );
        return dataDir;
      })();
    const postgresUrl = `file:${dataDir}`;
    process.env.POSTGRES_URL = postgresUrl;
    this.server = agentServer;
    this.messageServer = server as MessageServer & { metadata: AppContext };
    this.serverPort = serverPort;

    // Initialize managers
    this.agentManager = new AgentManager(
      this.server,
      this.config.runtimeConfig?.runtimeSettings || {},
      this.messageServer,
      this.defaultRuntimeDecorators, // ← pass decorators collected in ctor
    );

    // Initialize SocketIO client for real-time message streaming
    // "The House" acts as a human-like user that can stimulate agent responses
    // Generate a proper UUID for The House
    const houseRuntimeSettings: RuntimeSettings = {
      ...this.config.runtimeConfig?.runtimeSettings,
      // Pass house configuration as environment variables for plugin settings
      HOUSE_MIN_PLAYERS: this.config.houseConfig?.minPlayers?.toString() || "4",
      HOUSE_MAX_PLAYERS: this.config.houseConfig?.maxPlayers?.toString() || "8",
      HOUSE_AUTO_START:
        this.config.houseConfig?.autoStartGame?.toString() || "true",
    };

    this.houseAgent = new AgentRuntime({
      character: houseCharacter,
      plugins: [sqlPlugin, openaiPlugin, coordinatorPlugin, housePlugin],
      settings: houseRuntimeSettings,
    });

    this.associationManager = new AssociationManager();
    this.channelManager = new ChannelManager(
      this.agentManager,
      this.associationManager,
      this.server,
      this.messageServer,
      this.houseAgent,
    );
    this.gameManager = new GameManager(
      this.agentManager,
      this.channelManager,
      this.houseAgent,
      this.messageServer.id,
    );

    await this.houseAgent.initialize();
    await this.server.registerAgent(this.houseAgent);

    // Register house agent with AgentManager so ChannelManager can find it
    await this.agentManager.registerAgent(this.houseAgent, {
      name: "House",
      role: "house",
      entityName: "House",
    } as any);
    const worldId = createUniqueUuid(this.houseAgent, this.messageServer.id);
    let world = await this.houseAgent.getWorld(worldId);
    if (!world) {
      await this.houseAgent.createWorld({
        id: worldId,
        name: "Influence",
        agentId: this.houseAgent.agentId,
        serverId: this.messageServer.id,
        metadata: {
          ownership: {
            ownerId: this.houseAgent.agentId,
          },
          roles: {
            [this.houseAgent.agentId]: Role.OWNER,
          },
        },
      });
    }

    this.socketManager = SocketIOManager.getInstance();
    this.socketManager.initialize(this.houseAgent.agentId, this.serverPort);

    // Set up message streaming infrastructure
    this.setupMessageStreaming();
  }

  /**
   * Set up real-time message streaming from SocketIO and internal message bus
   */
  private setupMessageStreaming() {
    if (!this.socketManager) {
      throw new Error("SocketIOManager not initialized");
    }
    // Listen to SocketIO message broadcasts (messages from www client)
    this.socketManager.on("messageBroadcast", (data) => {
      logger.info(
        `[InfluenceApp] 📨 Received SocketIO message: ${data.senderId} -> "${data.text}"`,
      );
      logger.info(
        `[InfluenceApp] SocketIO message details: channelId=${data.channelId}, source=${data.source}`,
      );
      const streamedMessage: StreamedMessage = {
        id: data.id || stringToUuid(`message-${Date.now()}-${Math.random()}`),
        channelId: data.channelId,
        authorId: data.senderId,
        content: data.text,
        timestamp: data.createdAt,
        metadata: {
          senderName: data.senderName,
          source: data.source,
          ...data.metadata,
        },
        source: "client",
      };

      // Broadcast to global message stream
      this.messageStream$.next(streamedMessage);
    });

    // Listen to internal message bus for agent messages
    this.bus.on("new_message", (message) => {
      logger.info(
        `[InfluenceApp] 🔄 Received internal message bus message: ${message.author_id} -> "${message.content}"`,
      );
      logger.info(
        `[InfluenceApp] Internal message details: channelId=${message.channel_id}, serverId=${message.server_id}, sourceType=${message.source_type}`,
      );
      const streamedMessage: StreamedMessage = {
        id: message.id,
        channelId: message.channel_id,
        authorId: message.author_id,
        content: message.content,
        timestamp: message.created_at,
        metadata: {
          authorDisplayName: message.author_display_name,
          sourceType: message.source_type,
          ...message.metadata,
        },
        source: "agent",
      };

      this.broadcastMessage(streamedMessage);
    });

    logger.info(
      "[InfluenceApp] ✅ Message streaming infrastructure initialized",
    );
  }

  /**
   * Broadcast a message to all subscribers
   */
  private broadcastMessage(message: StreamedMessage) {
    // Broadcast to channel-specific stream
    const channelStream = this.channelMessageStreams.get(message.channelId);
    if (channelStream) {
      channelStream.next(message);
    }

    logger.debug(
      `Broadcasted message ${message.id} to channel ${message.channelId}`,
    );
  }

  getHouseAgent(): IAgentRuntime {
    if (!this.houseAgent) {
      throw new Error("House agent is not initialized");
    }
    return this.houseAgent;
  }

  /**
   * Get an observable stream of all messages
   */
  getMessageStream(): Observable<StreamedMessage> {
    return this.messageStream$;
  }

  /**
   * Get an observable stream of messages for a specific channel
   */
  getChannelMessageStream(channelId: UUID): Observable<StreamedMessage> {
    if (!this.channelMessageStreams.has(channelId)) {
      this.channelMessageStreams.set(channelId, new Subject<StreamedMessage>());
    }
    return this.channelMessageStreams.get(channelId)!.asObservable();
  }

  /**
   * Join a channel to receive real-time messages
   */
  async joinChannel(channelId: UUID): Promise<void> {
    if (!this.socketManager) {
      throw new Error("SocketIOManager not initialized");
    }
    await this.socketManager.joinChannel(channelId);
    logger.info(`Joined channel ${channelId} for real-time messaging`);
  }

  /**
   * Leave a channel to stop receiving real-time messages
   */
  leaveChannel(channelId: UUID): void {
    if (!this.socketManager) {
      throw new Error("SocketIOManager not initialized");
    }
    this.socketManager.leaveChannel(channelId);
    logger.info(`Left channel ${channelId}`);
  }

  async start() {
    if (!this.server) {
      throw new Error("Server not initialized");
    }
    if (!this.serverPort) {
      throw new Error("Server port not initialized");
    }
    this.server.start(this.serverPort);
  }

  async stop() {
    // Clean up managers (check if they exist first)
    if (this.channelManager) {
      await this.channelManager.cleanup();
    }
    if (this.agentManager) {
      await this.agentManager.cleanup();
    }

    // Stop server
    if (this.server) {
      await this.server.stop();
    }
  }

  // Agent management methods
  getAgentManager(): AgentManager<AgentContext, Runtime> {
    if (!this.agentManager) {
      throw new Error("Agent manager not initialized");
    }
    return this.agentManager;
  }

  // Channel management methods
  getChannelManager(): ChannelManager<AgentContext, Runtime> {
    if (!this.channelManager) {
      throw new Error("Channel manager not initialized");
    }
    return this.channelManager;
  }

  // Association management methods
  getAssociationManager(): AssociationManager {
    if (!this.associationManager) {
      throw new Error("Association manager not initialized");
    }
    return this.associationManager;
  }

  // Convenience methods for common operations
  async addAgent(
    config: Parameters<AgentManager<AgentContext, Runtime>["addAgent"]>[0],
  ) {
    if (!this.agentManager) {
      throw new Error("Agent manager not initialized");
    }
    return this.agentManager.addAgent(config);
  }

  async createChannel(
    config: Parameters<
      ChannelManager<AgentContext, Runtime>["createChannel"]
    >[0],
  ) {
    if (!this.channelManager) {
      throw new Error("Channel manager not initialized");
    }
    const channelId = await this.channelManager.createChannel(config);

    // Automatically join "The House" to the channel for real-time messaging
    await this.joinChannel(channelId);

    return channelId;
  }

  getServerPort() {
    return this.serverPort;
  }

  // Get statistics
  getStats() {
    if (!this.agentManager) {
      throw new Error("Agent manager not initialized");
    }
    if (!this.channelManager) {
      throw new Error("Channel manager not initialized");
    }
    if (!this.associationManager) {
      throw new Error("Association manager not initialized");
    }
    return {
      agents: this.agentManager.getStats(),
      channels: this.channelManager.getStats(),
      associations: this.associationManager.getStats(),
      messageStreams: {
        totalChannels: this.channelMessageStreams.size,
      },
    };
  }

  /**
   * Create a new game session
   */
  async createGame(config: GameConfig): Promise<UUID> {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager.createGame(config);
  }

  /**
   * Create a channel for a specific game with game state pre-loaded
   */
  async createGameChannel(
    gameId: UUID,
    channelConfig: Omit<
      Parameters<ChannelManager<AgentContext, Runtime>["createChannel"]>[0],
      "runtimeDecorators"
    >,
  ): Promise<UUID> {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager.createGameChannel(gameId, channelConfig);
  }

  /**
   * Create a main game channel with all players and House agent
   */
  async createMainGameChannel(
    gameId: UUID,
    channelName?: string,
  ): Promise<UUID> {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager.createMainGameChannel(gameId, channelName);
  }

  /**
   * Get game session by ID
   */
  getGame(gameId: UUID) {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager.getGame(gameId);
  }

  /**
   * Get game ID by channel ID
   */
  getGameByChannel(channelId: UUID) {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager.getGameByChannel(channelId);
  }

  /**
   * Get the game manager instance
   */
  getGameManager(): GameManager<AgentContext, Runtime> {
    if (!this.gameManager) {
      throw new Error("Game manager not initialized");
    }
    return this.gameManager;
  }

  /**
   * Send a message to a channel as "The House" - acting like a human user to stimulate agent responses
   * This follows the same pattern as a human user connecting via apps/www
   */
  async sendMessage(channelId: UUID, content: string, mentionAgentId?: UUID) {
    if (!this.channelManager) {
      throw new Error("Channel manager not initialized");
    }
    const channel = this.channelManager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Note: "The House" should already be joined to this channel when it was created

    // Optionally mention a specific agent to direct the message
    let finalContent = content;
    if (mentionAgentId) {
      if (!this.agentManager) {
        throw new Error("Agent manager not initialized");
      }
      const mentionedRuntime =
        this.agentManager.getAgentRuntime(mentionAgentId);
      if (mentionedRuntime) {
        finalContent = `@${mentionedRuntime.character.name} ${content}`;
      }
    }

    // Use SocketIOManager to send the message as "The House" user
    // This follows the same pattern as apps/www for consistent real-time messaging

    try {
      if (!this.socketManager) {
        throw new Error("SocketIOManager not initialized");
      }
      // Check if SocketIOManager is connected

      // Send message as "The House" user - this will stimulate agent responses
      await this.socketManager.sendMessage(
        finalContent,
        channelId,
        channel.messageServerId,
        channel.type === ChannelType.DM ? "client_chat" : "client_group_chat", // source
        [], // attachments
        undefined, // messageId - let it generate one
        {
          channelType: channel.type,
          isDm: channel.type === ChannelType.DM,
          mentionedAgentId: mentionAgentId,
          user_display_name: "The House",
          username: "The House",
        },
      );

      logger.info(`House message sent to channel ${channel.name}`);
    } catch (error) {
      logger.error("Failed to send House message:", error);
      throw error;
    }
  }
}
