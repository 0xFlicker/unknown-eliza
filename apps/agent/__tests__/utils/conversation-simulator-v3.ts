import { vi } from "vitest";
import dotenv from "dotenv";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
  stringToUuid,
  type IAgentRuntime,
  type UUID,
  type Content,
  createUniqueUuid,
  validateUuid,
  type Memory,
  EventType,
} from "@elizaos/core";
import {
  ModelMockingService,
  type AgentResponseResult,
} from "./model-mocking-service";
import { GameStatePreloader } from "./game-state-preloader";
import { Phase } from "../../src/house/types";
import fs from "fs";
import { randomUUID } from "crypto";
// Note: We'll need to import the message bus differently since it's internal to server
// For now, we'll use a different approach for message observation

const testEnv = dotenv.config({
  path: ".env.test",
});

/**
 * A message in the conversation with metadata
 */
export interface ConversationMessageV3 {
  id?: UUID;
  authorId: UUID;
  authorName: string;
  content: string;
  timestamp: number;
  channelId: UUID;
  providers?: string[]; // Providers that generated this message
  actions?: string[]; // Actions taken by the agent
  thought?: string; // Optional thoughts for debugging
  metadata?: any;
}

/**
 * Participant mode in a channel
 */
export enum ParticipantModeV3 {
  READ_WRITE = "read_write",
  BROADCAST_ONLY = "broadcast_only", // Can send but doesn't receive replies
  OBSERVE_ONLY = "observe_only", // Can only observe, cannot send
}

/**
 * Configuration for a channel participant
 */
export interface ChannelParticipantV3 {
  agentName: string;
  mode: ParticipantModeV3;
}

/**
 * Agent role assignment for game state setup
 */
export interface AgentRoleAssignment {
  /** Agent name */
  agentName: string;
  /** Role in the game */
  role: "house" | "player" | "host";
}

/**
 * Optional game state configuration for channels
 */
export interface GameStateConfigV3 {
  /** Game phase to pre-load */
  phase: Phase;
  /** Game round number */
  round?: number;
  /** Explicit agent role assignments (recommended) */
  agentRoles?: AgentRoleAssignment[];
  /** @deprecated Use agentRoles instead. Name of the host player (must be in participants) */
  hostPlayerName?: string;
  /** @deprecated Use agentRoles instead. House agent name (will receive game state memory) */
  houseAgentName?: string;
}

/**
 * Configuration for creating a channel
 */
export interface ChannelConfigV3 {
  name: string;
  participants: (string | ChannelParticipantV3)[]; // Agent names or full participant configs
  type?: ChannelType;
  maxMessages?: number; // Undefined = unlimited
  timeoutMs?: number; // Undefined = no timeout
  metadata?: any;
  /** Optional game state to pre-load for this channel */
  gameState?: GameStateConfigV3;
}

/**
 * Channel state and management for V3
 */
export interface ChannelV3 {
  id: UUID;
  name: string;
  type: ChannelType; // Explicit channel type instead of name-based detection
  participants: Map<string, ParticipantModeV3>; // agentName -> mode
  messages: ConversationMessageV3[];
  maxMessages?: number;
  timeoutMs?: number;
  createdAt: number;
  isExhausted: boolean;
  observers: ((message: ConversationMessageV3) => void)[];
}

/**
 * Response configuration for sendMessage
 */
export interface ResponseConfigV3 {
  maxReplies?: number; // undefined = no replies, Infinity = unlimited, number = max replies
  timeoutMs?: number; // Override default response timeout
}

/**
 * Configuration for the V3 conversation simulator
 */
export interface SimulatorConfigV3 {
  /** Test data directory */
  dataDir: string;
  /** Server port for testing */
  serverPort?: number;
  /** Enable real-time SocketIO integration */
  enableRealTime?: boolean;
  /** Enable comprehensive model mocking service */
  useModelMockingService?: boolean;
  /** Test context for recording organization */
  testContext?: {
    suiteName: string;
    testName: string;
  };
}

/**
 * Result from sending a message
 */
export interface MessageResultV3 {
  message: ConversationMessageV3;
  responses?: AgentResponseResult[]; // May be populated later via events
}

/**
 * Send message options
 */
export interface SendMessageOptionsV3 {
  triggerResponses?: boolean;
  maxReplies?: number;
  timeoutMs?: number;
  metadata?: any;
}

/**
 * Server message data structure matching AgentServer
 */
export interface ServerMessageData {
  id: UUID;
  channelId: UUID;
  authorId: UUID;
  content: string;
  createdAt: number;
  metadata?: any;
}

/**
 * ConversationSimulatorV3 provides a testing harness that properly integrates with AgentServer
 * instead of bypassing its infrastructure. It uses real server channels, message routing,
 * and event systems for authentic multi-agent conversation testing.
 */
export class ConversationSimulatorV3 {
  private server: AgentServer;
  private runtimes: Map<string, IAgentRuntime> = new Map();
  private channels: Map<UUID, ChannelV3> = new Map();
  private messageObservers: Map<
    UUID,
    ((message: ConversationMessageV3) => void)[]
  > = new Map();
  private modelMockingService?: ModelMockingService;
  private runtimeCleanupFunctions: Map<string, () => void> = new Map();
  private testStartTime?: number;
  private messageSequence: number = 0;
  private testServer?: { id: UUID; name: string };
  private busSubscriptions: Map<string, (...args: any[]) => void> = new Map();

  constructor(private config: SimulatorConfigV3) {
    this.server = new AgentServer();

    // Initialize model mocking service if enabled
    if (config.useModelMockingService !== false) {
      this.modelMockingService = new ModelMockingService();

      if (config.testContext) {
        this.modelMockingService.setTestContext(
          config.testContext.suiteName,
          config.testContext.testName
        );
      }
    }
  }

  /**
   * Initialize the simulator using AgentServer's infrastructure
   */
  async initialize(): Promise<void> {
    // Set deterministic test start time
    this.testStartTime = Date.now();
    this.messageSequence = 0;

    // Ensure data directory exists
    fs.mkdirSync(this.config.dataDir, { recursive: true });

    // Initialize AgentServer
    await this.server.initialize({ dataDir: this.config.dataDir });

    // Create test server for all channels
    this.testServer = await this.server.createServer({
      name: "test-conversation-server-v3",
      sourceType: "test",
    });

    // Test server created successfully

    // Start server if port specified for real-time features
    if (this.config.serverPort && this.config.enableRealTime) {
      this.server.start(this.config.serverPort);
    }
  }

  /**
   * Poll for new messages from the server
   */
  private async pollForNewMessages(
    channelId: UUID
  ): Promise<ConversationMessageV3[]> {
    try {
      const serverMessages = await this.server.getMessagesForChannel(channelId);
      const channel = this.channels.get(channelId);
      if (!channel) return [];

      // Convert server messages to conversation messages
      const newMessages: ConversationMessageV3[] = [];
      for (const serverMsg of serverMessages) {
        // Check if we already have this message
        const existingMessage = channel.messages.find(
          (m) => m.id === serverMsg.id
        );
        if (!existingMessage) {
          // Filter out empty messages when polling (consistent with callback filtering)
          const content = serverMsg.content?.trim() || "";
          if (content) {
            const convMsg: ConversationMessageV3 = {
              id: serverMsg.id,
              authorId: serverMsg.authorId,
              authorName:
                this.getAgentNameById(serverMsg.authorId) || "Unknown",
              content: content,
              timestamp: new Date(serverMsg.createdAt).getTime(),
              channelId,
              metadata: serverMsg.metadata,
            };
            newMessages.push(convMsg);
          }
        }
      }

      return newMessages;
    } catch (error) {
      console.warn("Error polling for messages:", error);
      return [];
    }
  }

  /**
   * Get agent name by ID
   */
  private getAgentNameById(agentId: UUID): string | undefined {
    for (const [name, runtime] of this.runtimes.entries()) {
      if (runtime.agentId === agentId) {
        return name;
      }
    }
    return undefined;
  }

  /**
   * Create a new channel using AgentServer infrastructure
   */
  async createChannel(config: ChannelConfigV3): Promise<UUID> {
    if (!this.testServer) {
      throw new Error(
        "Simulator not initialized. Please run initialize() first."
      );
    }

    // Create channel via AgentServer API
    const serverChannel = await this.server.createChannel({
      messageServerId: this.testServer.id,
      name: config.name,
      type: config.type || ChannelType.GROUP,
      metadata: config.metadata,
    });

    // Process participants and add them to the channel
    const participantIds: UUID[] = [];
    const participants = new Map<string, ParticipantModeV3>();

    for (const participant of config.participants) {
      if (typeof participant === "string") {
        participants.set(participant, ParticipantModeV3.READ_WRITE);
        const agentId = this.getAgentId(participant);
        if (agentId) {
          participantIds.push(agentId);
        }
      } else {
        participants.set(participant.agentName, participant.mode);
        const agentId = this.getAgentId(participant.agentName);
        if (agentId) {
          participantIds.push(agentId);
        }
      }
    }

    // Add participants to the channel via server API
    if (participantIds.length > 0) {
      await this.server.addParticipantsToChannel(
        serverChannel.id,
        participantIds
      );
    }

    // Create channel metadata for tracking
    const channel: ChannelV3 = {
      id: serverChannel.id,
      name: config.name,
      type: config.type || ChannelType.GROUP, // Use explicit type from config
      participants,
      messages: [],
      maxMessages: config.maxMessages,
      timeoutMs: config.timeoutMs,
      createdAt: Date.now(),
      isExhausted: false,
      observers: [],
    };

    this.channels.set(serverChannel.id, channel);
    this.messageObservers.set(serverChannel.id, []);

    // Handle optional game state pre-loading
    if (config.gameState) {
      await this.setupGameState(
        serverChannel.id,
        config.gameState,
        participants
      );
    }

    return serverChannel.id;
  }

  /**
   * Set up game state for a channel with House agent and players
   */
  private async setupGameState(
    channelId: UUID,
    gameStateConfig: GameStateConfigV3,
    participants: Map<string, ParticipantModeV3>
  ): Promise<void> {
    // Process agent roles - prefer explicit assignment over legacy fallback
    let houseAgentName: string | undefined;
    let hostPlayerName: string | undefined;
    const playerNames: string[] = [];
    const playerAgentIds = new Map<string, UUID>();

    if (gameStateConfig.agentRoles && gameStateConfig.agentRoles.length > 0) {
      // Use explicit role assignments
      for (const roleAssignment of gameStateConfig.agentRoles) {
        const { agentName, role } = roleAssignment;

        // Verify agent exists in participants
        if (!participants.has(agentName)) {
          throw new Error(
            `Agent "${agentName}" with role "${role}" not found in channel participants`
          );
        }

        const agentId = this.getAgentId(agentName);
        if (!agentId) {
          throw new Error(`Agent "${agentName}" runtime not found`);
        }

        if (role === "house") {
          if (houseAgentName) {
            throw new Error(
              `Multiple house agents specified: "${houseAgentName}" and "${agentName}"`
            );
          }
          houseAgentName = agentName;
        } else if (role === "player" || role === "host") {
          playerNames.push(agentName);
          playerAgentIds.set(agentName, agentId);

          if (role === "host") {
            if (hostPlayerName) {
              throw new Error(
                `Multiple host players specified: "${hostPlayerName}" and "${agentName}"`
              );
            }
            hostPlayerName = agentName;
          }
        }
      }

      // Validate required roles
      if (!houseAgentName) {
        throw new Error(
          'No house agent specified in agentRoles. At least one agent must have role "house"'
        );
      }
      if (playerNames.length === 0) {
        throw new Error(
          'No player agents specified in agentRoles. At least one agent must have role "player" or "host"'
        );
      }
      if (!hostPlayerName) {
        // Auto-assign first player as host if no explicit host
        hostPlayerName = playerNames[0];
      }
    } else {
      // Legacy fallback - identify House agent and players using old logic
      houseAgentName =
        gameStateConfig.houseAgentName ||
        Array.from(participants.keys()).find((name) =>
          name.toLowerCase().includes("house")
        );

      if (!houseAgentName) {
        throw new Error(
          'No House agent found for game state setup. Use agentRoles to specify explicitly, or provide houseAgentName, or include agent with "house" in name.'
        );
      }

      // Extract player names and agent IDs (excluding House)
      for (const [agentName, mode] of participants.entries()) {
        if (agentName !== houseAgentName) {
          playerNames.push(agentName);
          const agentId = this.getAgentId(agentName);
          if (agentId) {
            playerAgentIds.set(agentName, agentId);
          }
        }
      }

      if (playerNames.length === 0) {
        throw new Error("No player agents found for game state setup");
      }

      // Determine host player
      hostPlayerName = gameStateConfig.hostPlayerName || playerNames[0];
      if (!playerNames.includes(hostPlayerName)) {
        throw new Error(
          `Host player "${hostPlayerName}" not found in participants`
        );
      }
    }

    const houseRuntime = this.runtimes.get(houseAgentName);
    if (!houseRuntime) {
      throw new Error(`House agent "${houseAgentName}" runtime not found`);
    }

    // Create room/world structure for House agent
    const roomId = createUniqueUuid(houseRuntime, channelId);
    const worldId = createUniqueUuid(houseRuntime, "game-world");

    await houseRuntime.ensureWorldExists({
      id: worldId,
      name: "Game World",
      agentId: houseRuntime.agentId,
      serverId: "game-server",
    });

    await houseRuntime.ensureRoomExists({
      id: roomId,
      name: `game-channel-${gameStateConfig.phase.toLowerCase()}`,
      agentId: houseRuntime.agentId,
      worldId: worldId,
      channelId: channelId,
      serverId: "game-server",
      source: "test-simulator-v3",
      type: ChannelType.GROUP,
    });

    // Use GameStatePreloader to set up the game state
    let gameState;
    switch (gameStateConfig.phase) {
      case Phase.LOBBY:
        gameState = await GameStatePreloader.preloadLobbyPhase(
          houseRuntime,
          roomId,
          playerNames,
          playerAgentIds
        );
        console.log(
          `🎮 Pre-loaded ${gameStateConfig.phase} phase: ${playerNames.length} players ready for conversation`
        );
        break;

      case Phase.INIT:
        gameState = await GameStatePreloader.preloadInfluenceGame(
          houseRuntime,
          roomId,
          {
            playerNames,
            hostPlayerName,
            playerAgentIds,
          }
        );
        console.log(
          `🎮 Pre-loaded ${gameStateConfig.phase} phase: ${playerNames.length} players joined, ready to start`
        );
        break;

      default:
        // For other phases, create basic game state
        gameState = GameStatePreloader.createGameState({
          playerNames,
          hostPlayerName,
          phase: gameStateConfig.phase,
          round: gameStateConfig.round || 0,
          playerAgentIds,
        });
        await GameStatePreloader.saveGameStateToRuntime(
          houseRuntime,
          roomId,
          gameState
        );
        console.log(
          `🎮 Pre-loaded ${gameStateConfig.phase} phase: ${playerNames.length} players in game state`
        );
        break;
    }

    // TODO: Add player-specific memory setup here if needed
    // Each player agent could receive relevant game memories based on their role
  }

  /**
   * Get agent ID by name
   */
  private getAgentId(agentName: string): UUID | undefined {
    const runtime = this.runtimes.get(agentName);
    return runtime?.agentId;
  }

  /**
   * Subscribe to new messages in a channel
   */
  observeChannel(
    channelId: UUID,
    observer: (message: ConversationMessageV3) => void
  ): () => void {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!this.messageObservers.has(channelId)) {
      this.messageObservers.set(channelId, []);
    }

    this.messageObservers.get(channelId)!.push(observer);

    // Return unsubscribe function
    return () => {
      const observers = this.messageObservers.get(channelId);
      if (observers) {
        const index = observers.indexOf(observer);
        if (index > -1) {
          observers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Check if a channel is exhausted (reached message limit or timeout)
   */
  isChannelExhausted(channelId: UUID): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return true;

    if (channel.isExhausted) return true;

    // Check message limit
    if (channel.maxMessages && channel.messages.length >= channel.maxMessages) {
      channel.isExhausted = true;
      return true;
    }

    // Check timeout
    if (
      channel.timeoutMs &&
      Date.now() - channel.createdAt > channel.timeoutMs
    ) {
      channel.isExhausted = true;
      return true;
    }

    return false;
  }

  /**
   * Add an agent runtime to the conversation
   */
  async addAgent(
    agentName: string,
    character: any,
    plugins: any[] = []
  ): Promise<IAgentRuntime> {
    const runtime = new AgentRuntime({
      character: { ...character, name: agentName },
      plugins,
      settings: {
        ...testEnv.parsed,
        DATABASE_PATH: this.config.dataDir,
      },
    });

    await runtime.initialize();
    await this.server.registerAgent(runtime);
    if (this.modelMockingService) {
      const cleanup = this.modelMockingService.patchRuntime(runtime, agentName);
      this.runtimeCleanupFunctions.set(agentName, cleanup);
    }

    this.runtimes.set(agentName, runtime);
    return runtime;
  }

  /**
   * Send a message using Discord-style direct event emission to trigger agent responses
   */
  async sendMessage(
    fromAgent: string,
    channelId: UUID,
    content: string,
    options?: SendMessageOptionsV3
  ): Promise<MessageResultV3> {
    const fromRuntime = this.runtimes.get(fromAgent);
    if (!fromRuntime) {
      throw new Error(`Agent ${fromAgent} not found`);
    }

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Check if channel is exhausted
    if (this.isChannelExhausted(channelId)) {
      throw new Error(
        `Channel ${channel.name} is exhausted (reached message limit or timeout)`
      );
    }

    // Check if sender can send to this channel
    const senderMode = channel.participants.get(fromAgent);
    if (!senderMode) {
      throw new Error(
        `Agent ${fromAgent} is not a participant in channel ${channel.name}`
      );
    }
    if (senderMode === ParticipantModeV3.OBSERVE_ONLY) {
      throw new Error(
        `Agent ${fromAgent} is observe-only in channel ${channel.name}`
      );
    }

    // Increment message sequence for deterministic ordering
    this.messageSequence++;
    const deterministicTimestamp =
      (this.testStartTime || Date.now()) + this.messageSequence * 1000;

    // Store the message to the server to maintain data consistency and get server-generated ID
    const serverMessage = await this.server.createMessage({
      authorId: fromRuntime.agentId,
      content,
      channelId,
      metadata: options?.metadata,
    });

    const conversationMessage: ConversationMessageV3 = {
      id: serverMessage.id, // Use server-generated ID to prevent duplication
      authorId: fromRuntime.agentId,
      authorName: fromAgent,
      content,
      timestamp: deterministicTimestamp,
      channelId,
      metadata: options?.metadata,
    };

    // Add to local tracking immediately
    channel.messages.push(conversationMessage);

    // Notify channel observers immediately
    const observers = this.messageObservers.get(channelId);
    if (observers) {
      observers.forEach((observer) => {
        try {
          observer(conversationMessage);
        } catch (error) {
          console.warn("Channel observer error:", error);
        }
      });
    }

    // NOW THE KEY PART: Emit MESSAGE_RECEIVED events directly to all participating agents
    // This mimics what Discord plugin does and should trigger automatic responses
    await this.emitMessageToParticipants(
      channelId,
      conversationMessage,
      fromAgent
    );

    return {
      message: conversationMessage,
      responses: [], // Responses will be generated via direct event emission
    };
  }

  /**
   * Emit MESSAGE_RECEIVED events directly to all participating agents (except sender)
   * This mimics the Discord plugin's approach for triggering automatic responses
   */
  private async emitMessageToParticipants(
    channelId: UUID,
    message: ConversationMessageV3,
    senderAgent: string
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    // Emit MESSAGE_RECEIVED events to participating agents

    // Find all participating agents (except the sender)
    for (const [agentName, mode] of channel.participants.entries()) {
      if (agentName === senderAgent) continue; // Don't send to sender
      if (mode === ParticipantModeV3.BROADCAST_ONLY) continue; // Can't receive

      const targetRuntime = this.runtimes.get(agentName);
      if (!targetRuntime) {
        console.warn(`Agent ${agentName} runtime not found`);
        continue;
      }

      // Emit MESSAGE_RECEIVED event to agent

      // Create the message memory for this agent (similar to Discord plugin)
      const roomId = createUniqueUuid(targetRuntime, channelId);
      const worldId = createUniqueUuid(targetRuntime, this.testServer!.id);
      const authorEntityId = createUniqueUuid(targetRuntime, message.authorId);

      // CRITICAL: Ensure connection exists first (like Discord does)
      await targetRuntime.ensureConnection({
        entityId: authorEntityId,
        roomId: roomId,
        userName: message.authorName,
        name: message.authorName,
        source: "test-simulator-v3",
        channelId: channelId,
        serverId: this.testServer!.id,
        type: channel.type, // Use explicit channel type
        worldId: worldId,
        worldName: "Test Conversation Server",
      });

      const messageMemory: Memory = {
        id: createUniqueUuid(targetRuntime, message.id || randomUUID()),
        entityId: authorEntityId,
        agentId: targetRuntime.agentId,
        roomId: roomId,
        content: {
          text: message.content,
          source: "test-simulator-v3",
          channelType: channel.type, // Use explicit channel type
        },
        metadata: {
          entityName: message.authorName,
          fromId: message.authorId,
          type: "message",
          ...message.metadata,
        },
        createdAt: message.timestamp,
      };

      // Create response callback (similar to Discord plugin)
      const callback = async (responseContent: Content): Promise<Memory[]> => {
        // Log the response content for debugging
        console.log(`🤖 ${agentName} callback received:`, {
          text: responseContent.text,
          textLength: responseContent.text?.length || 0,
          thought: responseContent.thought,
          actions: responseContent.actions,
          providers: responseContent.providers,
        });

        // Filter out empty responses (common ElizaOS convention)
        const responseText = responseContent.text?.trim() || "";

        // Create response message and add it to our tracking
        const responseTimestamp = Date.now();

        // Store response to server and get server-generated ID (even if empty for debugging)
        const serverResponse = await this.server.createMessage({
          authorId: targetRuntime.agentId,
          content: responseText || "[EMPTY RESPONSE]",
          channelId,
          metadata: { generatedResponse: true, originalContent: responseContent },
        });

        const responseMessage: ConversationMessageV3 = {
          id: serverResponse.id, // Use server-generated ID to prevent duplication
          authorId: targetRuntime.agentId,
          authorName: agentName,
          content: responseText || "[EMPTY RESPONSE]",
          timestamp: responseTimestamp,
          channelId,
          providers: responseContent.providers,
          thought: responseContent.thought,
          actions: responseContent.actions,
          metadata: { generatedResponse: true },
        };

        // Add to local tracking
        channel.messages.push(responseMessage);

        // Notify observers
        const observers = this.messageObservers.get(channelId);
        if (observers) {
          observers.forEach((observer) => {
            try {
              observer(responseMessage);
            } catch (error) {
              console.warn("Channel observer error:", error);
            }
          });
        }

        // Response added to channel

        // Return memory for the response (required by callback interface)
        const responseMemory: Memory = {
          id: createUniqueUuid(targetRuntime, serverResponse.id),
          entityId: targetRuntime.agentId,
          agentId: targetRuntime.agentId,
          content: responseContent,
          roomId: roomId,
          createdAt: responseTimestamp,
        };

        return [responseMemory];
      };

      // Emit MESSAGE_RECEIVED event directly (like Discord plugin does)
      console.log(`🚀 Emitting MESSAGE_RECEIVED event to ${agentName} for message: "${message.content.substring(0, 50)}..."`);
      targetRuntime.emitEvent(EventType.MESSAGE_RECEIVED, {
        runtime: targetRuntime,
        message: messageMemory,
        callback,
      });

      console.log(`✅ MESSAGE_RECEIVED event emitted successfully to ${agentName}`);
    }
  }

  /**
   * Wait for a specific number of messages in a channel
   */
  async waitForChannelMessages(
    channelId: UUID,
    expectedCount: number,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    const startTime = Date.now();
    const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
    const pollInterval = isRecordMode ? 500 : 100; // Poll every 500ms in record mode, 100ms in playback

    while (Date.now() - startTime < timeoutMs) {
      // Poll for new messages from the server
      const newMessages = await this.pollForNewMessages(channelId);

      // Add any new messages to our local store and notify observers
      for (const newMsg of newMessages) {
        channel.messages.push(newMsg);

        // Notify observers
        const observers = this.messageObservers.get(channelId);
        if (observers) {
          observers.forEach((observer) => {
            try {
              observer(newMsg);
            } catch (error) {
              console.warn("Channel observer error:", error);
            }
          });
        }
      }

      // Check if we have enough messages now
      if (channel.messages.length >= expectedCount) {
        return true;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    if (!isRecordMode) {
      console.warn(
        `⚠️ waitForChannelMessages timeout: expected ${expectedCount}, got ${channel.messages.length} (timeout: ${timeoutMs}ms)`
      );
    }
    return false;
  }

  /**
   * Get messages from a specific channel
   */
  getChannelMessages(channelId: UUID): ConversationMessageV3[] {
    const channel = this.channels.get(channelId);
    return channel ? [...channel.messages] : [];
  }

  /**
   * Get a specific agent runtime
   */
  getAgent(agentName: string): IAgentRuntime | undefined {
    return this.runtimes.get(agentName);
  }

  /**
   * Get all agent names
   */
  getAgentNames(): string[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Get all channels
   */
  getChannels(): Map<UUID, ChannelV3> {
    return new Map(this.channels);
  }

  /**
   * Create a one-on-one channel between two agents
   */
  async createPrivateChannel(agent1: string, agent2: string): Promise<UUID> {
    return await this.createChannel({
      name: `private-${agent1}-${agent2}`,
      participants: [agent1, agent2],
      type: ChannelType.DM,
    });
  }

  /**
   * Create a broadcast channel where one agent sends and others only receive
   */
  async createBroadcastChannel(
    broadcaster: string,
    receivers: string[],
    channelName?: string
  ): Promise<UUID> {
    const participants: ChannelParticipantV3[] = [
      { agentName: broadcaster, mode: ParticipantModeV3.BROADCAST_ONLY },
      ...receivers.map((name) => ({
        agentName: name,
        mode: ParticipantModeV3.READ_WRITE,
      })),
    ];

    return this.createChannel({
      name: channelName || `broadcast-${broadcaster}`,
      participants,
    });
  }

  /**
   * Create a summary of conversations across all channels
   */
  createConversationSummary(): {
    channelCount: number;
    totalMessages: number;
    participantCount: number;
    messagesByAgent: Record<string, number>;
    messagesByChannel: Record<string, number>;
  } {
    const messagesByAgent: Record<string, number> = {};
    const messagesByChannel: Record<string, number> = {};
    let totalMessages = 0;

    for (const [channelId, channel] of this.channels.entries()) {
      messagesByChannel[channel.name] = channel.messages.length;
      totalMessages += channel.messages.length;

      for (const message of channel.messages) {
        messagesByAgent[message.authorName] =
          (messagesByAgent[message.authorName] || 0) + 1;
      }
    }

    return {
      channelCount: this.channels.size,
      totalMessages,
      participantCount: this.getAgentNames().length,
      messagesByAgent,
      messagesByChannel,
    };
  }

  /**
   * Get model mocking service for advanced testing
   */
  getModelMockingService(): ModelMockingService | undefined {
    return this.modelMockingService;
  }

  /**
   * Get the AgentServer instance for debugging
   */
  getServer(): AgentServer {
    return this.server;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Clean up runtime model mocking patches
    for (const cleanup of this.runtimeCleanupFunctions.values()) {
      cleanup();
    }
    this.runtimeCleanupFunctions.clear();

    // Clean up message bus subscriptions (if any were set up)
    this.busSubscriptions.clear();

    // Save recordings if using model mocking service
    if (this.modelMockingService) {
      await this.modelMockingService.saveRecordings();
    }

    // Stop server and clean up
    await this.server.stop();
    this.runtimes.clear();
    this.channels.clear();
    this.messageObservers.clear();
  }
}
