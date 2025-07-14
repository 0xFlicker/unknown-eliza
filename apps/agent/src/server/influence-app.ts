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
import {
  Agent,
  AppServerConfig,
  RuntimeDecorator,
  StreamedMessage,
} from "./types";
import EventEmitter from "node:events";
import { housePlugin } from "../../src/plugins/house";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { createAgentServer } from "./factory";
import { AgentManager } from "./agent-manager";
import { ChannelManager } from "./channel-manager";
import { AssociationManager } from "./association-manager";
import { SocketIOManager } from "../lib/socketio-manager";
import { Subject, Observable, fromEvent, Subscription } from "rxjs";
import { map } from "rxjs/operators";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { MessageServer } from "@elizaos/server";
import houseCharacter from "@/characters/house";
import { apiClient } from "@/lib/api";
import {
  coordinatorPlugin,
  createGameEventMessage,
} from "../plugins/coordinator";

/**
 * Unified game-event payload emitted from runtimes and internal bus
 */
export interface GameEvent<T = any> {
  type: string;
  payload: T;
  sourceAgent: UUID;
  channelId?: UUID;
  timestamp: number;
}

export class InfluenceApp<
  AgentContext extends Record<string, unknown>,
  AppContext extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private server: AgentServer;
  private messageServer: MessageServer;
  private houseClientId: UUID;
  private serverMetadata: AppContext;
  private serverPort: number;
  private bus: EventEmitter;

  // Managers
  private associationManager: AssociationManager;
  private agentManager: AgentManager<AgentContext>;
  private channelManager: ChannelManager;

  // The house agent
  private houseAgent: IAgentRuntime | null = null;

  // Message streaming infrastructure
  private socketManager: SocketIOManager;
  private messageStream$ = new Subject<StreamedMessage>();
  private channelMessageStreams = new Map<UUID, Subject<StreamedMessage>>();

  // Game-event streaming infrastructure
  private gameEvent$ = new Subject<GameEvent<any>>();

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
        return runtime as Runtime;
      });
    }
    // Hook direct runtime emits into our game-event stream
    const hookEvents: RuntimeDecorator<Runtime> = (runtime) => {
      const originalEmit = runtime.emitEvent.bind(runtime);
      runtime.emitEvent = async (eventType, payload) => {
        const p: any = payload;
        const rawRoom = p.roomId ?? p.channelId;
        const typeString = (
          Array.isArray(eventType) ? eventType[0] : eventType
        ) as string;
        this.gameEvent$.next({
          type: typeString,
          payload,
          sourceAgent: runtime.agentId,
          channelId: Array.isArray(rawRoom) ? rawRoom[0] : rawRoom,
          timestamp: Date.now(),
        });
        return originalEmit(eventType, payload);
      };
      return runtime;
    };
    this.defaultRuntimeDecorators.push(hookEvents);
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
    this.messageServer = server;
    this.serverMetadata = server.metadata as AppContext;
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
      plugins: [sqlPlugin, openaiPlugin, housePlugin, coordinatorPlugin],
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
    this.setupGameEventStreaming();
  }

  /**
   * Set up real-time message streaming from SocketIO and internal message bus
   */
  private setupMessageStreaming() {
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
   * Set up unified game-event stream from internal bus and runtime emits
   */
  private setupGameEventStreaming() {
    /*
     * Coordination messages are emitted onto `internalMessageBus` by the
     * CoordinatorService.  For `game_event` messages we expect a single
     * argument – the coordination message object itself.  Previous logic
     * attempted to de-structure `(type, payload)` but CoordinatorService only
     * passes one arg which meant `type` became the whole object and `payload`
     * was undefined.  That broke downstream filtering (e.g. looking for
     * `GAME:I_AM_READY`).  The new logic treats the first argument as the
     * message object and extracts the canonical `gameEventType` and `payload`
     * fields.
     */

    fromEvent(internalMessageBus, "game_event", (message) => message)
      .pipe(
        map((coordinationMessage: any) => {
          console.log(
            "[InfluenceApp] received coordinationMessage",
            coordinationMessage.gameEventType,
            "from",
            coordinationMessage.sourceAgent,
          );
          // Shape asserted via Coordinator `createGameEventMessage`
          const typeString = coordinationMessage.gameEventType as string;
          const payload = coordinationMessage.payload ?? {};
          const rawRoom = payload.roomId ?? payload.channelId;

          return {
            type: typeString,
            payload,
            sourceAgent: coordinationMessage.sourceAgent ?? payload.source,
            channelId: Array.isArray(rawRoom) ? rawRoom[0] : rawRoom,
            timestamp: coordinationMessage.timestamp ?? Date.now(),
          } as GameEvent<any>;
        }),
      )
      .subscribe(this.gameEvent$);
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
    return this.messageStream$.asObservable();
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
   * Get a cold observable of all game events
   */
  getGameEventStream(): Observable<GameEvent<any>> {
    return this.gameEvent$.asObservable();
  }

  emitGameEvent<T = any>(gameEvent: GameEvent<T>): void {
    const event: GameEvent<T> = {
      type: gameEvent.type,
      payload: gameEvent.payload,
      sourceAgent: gameEvent.sourceAgent,
      channelId: gameEvent.channelId,
      timestamp: Date.now(),
    };
    this.gameEvent$.next(event);
    logger.info(
      `[InfluenceApp] Game event emitted: ${event.type} from ${event.sourceAgent} in channel ${event.channelId}`,
    );
    if (event.type === "GAME:I_AM_READY") {
      console.log("[InfluenceApp] observed I_AM_READY from", event.sourceAgent);
    }

    // Broadcast to internal coordination bus so that all runtimes (including
    // those in other agents) can react.
    const coordinationMessage = createGameEventMessage(
      event.sourceAgent,
      event.type as any,
      event.payload as any,
      "all",
    );
    internalMessageBus.emit("game_event", coordinationMessage);
  }

  /**
   * Subscribe to game events with a callback; returns a Subscription
   */
  observeGameEvents<T = any>(
    observer: (event: GameEvent<T>) => void,
  ): Subscription {
    return this.gameEvent$.subscribe(observer as any);
  }

  /**
   * Join a channel to receive real-time messages
   */
  async joinChannel(channelId: UUID): Promise<void> {
    await this.socketManager.joinChannel(channelId);
    logger.info(`Joined channel ${channelId} for real-time messaging`);
  }

  /**
   * Leave a channel to stop receiving real-time messages
   */
  leaveChannel(channelId: UUID): void {
    this.socketManager.leaveChannel(channelId);
    logger.info(`Left channel ${channelId}`);
  }

  async start() {
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
    config: Parameters<AgentManager<AgentContext>["addAgent"]>[0],
  ) {
    return this.agentManager.addAgent(config);
  }

  async createChannel(config: Parameters<ChannelManager["createChannel"]>[0]) {
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
    return {
      agents: this.agentManager.getStats(),
      channels: this.channelManager.getStats(),
      associations: this.associationManager.getStats(),
      messageStreams: {
        totalChannels: this.channelMessageStreams.size,
        globalStreamActive: this.messageStream$.observed,
      },
    };
  }

  /**
   * Send a message to a channel as "The House" - acting like a human user to stimulate agent responses
   * This follows the same pattern as a human user connecting via apps/www
   */
  async sendMessage(channelId: UUID, content: string, mentionAgentId?: UUID) {
    const channel = this.channelManager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Note: "The House" should already be joined to this channel when it was created

    // Optionally mention a specific agent to direct the message
    let finalContent = content;
    if (mentionAgentId) {
      const mentionedRuntime =
        this.agentManager.getAgentRuntime(mentionAgentId);
      if (mentionedRuntime) {
        finalContent = `@${mentionedRuntime.character.name} ${content}`;
      }
    }

    // Use SocketIOManager to send the message as "The House" user
    // This follows the same pattern as apps/www for consistent real-time messaging

    try {
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
