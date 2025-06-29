import { vi } from "vitest";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
  Content,
  EventType,
  ModelType,
  stringToUuid,
  type IAgentRuntime,
  type Memory,
  type UUID,
  type HandlerCallback,
  State,
  MemoryMetadata,
  MemoryType,
  MessageMemory,
  createUniqueUuid,
} from "@elizaos/core";
import {
  ModelMockingService,
  type AgentResponseResult,
} from "./model-mocking-service";
import fs from "fs";

/**
 * Legacy configuration for model response mocking (deprecated - use ModelMockingService)
 */
export interface LegacyModelMockConfig {
  /** Agent ID to mock responses for */
  agentId: string;
  /** Predefined responses to return in order */
  responses: string[];
  /** Whether to record actual model calls for playback */
  recordMode?: boolean;
  /** File path to save/load recordings */
  recordingPath?: string;
}

/**
 * Configuration for model response mocking (for backward compatibility)
 */
export interface ModelMockConfig extends LegacyModelMockConfig {}

/**
 * A message in the conversation with metadata
 */
export interface ConversationMessage {
  id?: UUID;
  authorId: UUID;
  authorName: string;
  content: string;
  timestamp: number;
  channelId: UUID;
}

/**
 * Participant mode in a channel
 */
export enum ParticipantMode {
  READ_WRITE = "read_write",
  BROADCAST_ONLY = "broadcast_only", // Can send but doesn't receive replies
  OBSERVE_ONLY = "observe_only", // Can only observe, cannot send
}

/**
 * Configuration for a channel participant
 */
export interface ChannelParticipant {
  agentName: string;
  mode: ParticipantMode;
}

/**
 * Configuration for creating a channel
 */
export interface ChannelConfig {
  name: string;
  participants: (string | ChannelParticipant)[]; // Agent names or full participant configs
  maxMessages?: number; // Undefined = unlimited
  timeoutMs?: number; // Undefined = no timeout
}

/**
 * Channel state and management
 */
export interface Channel {
  id: UUID;
  name: string;
  participants: Map<string, ParticipantMode>; // agentName -> mode
  messages: ConversationMessage[];
  maxMessages?: number;
  timeoutMs?: number;
  createdAt: number;
  isExhausted: boolean;
  observers: ((message: ConversationMessage) => void)[];
}

/**
 * Response configuration for sendMessage
 */
export interface ResponseConfig {
  maxReplies?: number; // undefined = no replies, Infinity = unlimited, number = max replies
  timeoutMs?: number; // Override default response timeout
}

/**
 * Configuration for the conversation simulator
 */
export interface SimulatorConfig {
  /** Number of agents to create */
  agentCount: number;
  /** Legacy model mocking configurations (deprecated) */
  modelMocks?: ModelMockConfig[];
  /** Test data directory */
  dataDir: string;
  /** Server port for testing */
  serverPort?: number;
  /** Enable comprehensive model mocking service */
  useModelMockingService?: boolean;
  /** Test context for recording organization */
  testContext?: {
    suiteName: string;
    testName: string;
  };
}

/**
 * ConversationSimulator provides a testing harness for multi-agent conversations
 * with support for model response mocking and conversation recording/playback.
 */
export class ConversationSimulator {
  private server: AgentServer;
  private runtimes: Map<string, IAgentRuntime> = new Map();
  private messageHistory: ConversationMessage[] = []; // Global message history for compatibility
  private channels: Map<UUID, Channel> = new Map(); // All channels
  private defaultChannelId?: UUID; // For backward compatibility
  private modelMocks: Map<string, ModelMockConfig> = new Map();
  private responseIndices: Map<string, number> = new Map();
  private modelMockingService?: ModelMockingService;
  private runtimeCleanupFunctions: Map<string, () => void> = new Map();
  private testStartTime?: number; // Track test start time for deterministic timing
  private messageSequence: number = 0; // Global message sequence counter

  constructor(private config: SimulatorConfig) {
    this.server = new AgentServer();

    // Set up legacy model mocks
    config.modelMocks?.forEach((mock) => {
      this.modelMocks.set(mock.agentId, mock);
      this.responseIndices.set(mock.agentId, 0);
    });

    // Initialize model mocking service if enabled
    if (config.useModelMockingService !== false) {
      // Default to true
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
   * Initialize the simulator with agents and server
   */
  async initialize(): Promise<void> {
    // Set deterministic test start time
    this.testStartTime = Date.now();
    this.messageSequence = 0;

    // Ensure data directory exists
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    // Initialize server
    await this.server.initialize({ dataDir: this.config.dataDir });

    // Create test server and default channel
    const msgSrv = await this.server.createServer({
      name: "test-conversation-server",
      sourceType: "test",
    });

    const serverChannel = await this.server.createChannel({
      messageServerId: msgSrv.id,
      name: "test-conversation-room",
      type: ChannelType.GROUP,
    });

    // Create default channel for backward compatibility
    this.defaultChannelId = serverChannel.id;
    const defaultChannel: Channel = {
      id: serverChannel.id,
      name: "default",
      participants: new Map(),
      messages: [],
      createdAt: Date.now(),
      isExhausted: false,
      observers: [],
    };
    this.channels.set(serverChannel.id, defaultChannel);

    // Start server if port specified
    if (this.config.serverPort) {
      this.server.start(this.config.serverPort);
    }
  }

  /**
   * Create a new channel with specified participants and configuration
   */
  async createChannel(config: ChannelConfig): Promise<UUID> {
    if (!this.defaultChannelId) {
      throw new Error(
        "Simulator not initialized. Please run initialize() first."
      );
    }

    // Create server channel (use the same server as the default channel)
    const servers = await this.server.getServers();
    const testServer = servers.find(
      (s) => s.name === "test-conversation-server"
    );
    if (!testServer) {
      throw new Error(
        "Test server not found. Please ensure initialize() was called first."
      );
    }

    const serverChannel = await this.server.createChannel({
      messageServerId: testServer.id,
      name: config.name,
      type: ChannelType.GROUP,
    });

    // Process participants
    const participants = new Map<string, ParticipantMode>();
    for (const participant of config.participants) {
      if (typeof participant === "string") {
        participants.set(participant, ParticipantMode.READ_WRITE);
      } else {
        participants.set(participant.agentName, participant.mode);
      }
    }

    // Create channel metadata
    const channel: Channel = {
      id: serverChannel.id,
      name: config.name,
      participants,
      messages: [],
      maxMessages: config.maxMessages,
      timeoutMs: config.timeoutMs,
      createdAt: Date.now(),
      isExhausted: false,
      observers: [],
    };

    this.channels.set(serverChannel.id, channel);
    return serverChannel.id;
  }

  /**
   * Subscribe to new messages in a channel
   */
  observeChannel(
    channelId: UUID,
    observer: (message: ConversationMessage) => void
  ): () => void {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    channel.observers.push(observer);

    // Return unsubscribe function
    return () => {
      const index = channel.observers.indexOf(observer);
      if (index > -1) {
        channel.observers.splice(index, 1);
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
    if (!this.defaultChannelId) {
      throw new Error(
        "Simulator not initialized - no channel available. Please run initialize() first."
      );
    }
    const runtime = new AgentRuntime({
      character: { ...character, name: agentName },
      plugins,
      settings: { DATABASE_PATH: this.config.dataDir },
    });

    await runtime.initialize();
    await this.server.registerAgent(runtime);

    // Create and ensure world and room exist for this agent
    try {
      const { agentWorldId, agentRoomId } =
        await this.ensureWorldAndRoomExist(runtime);

      // Ensure the world exists in the agent's database
      await runtime.ensureWorldExists({
        id: agentWorldId,
        agentId: runtime.agentId,
        serverId: "00000000-0000-0000-0000-000000000000",
      });

      // Now ensure the room exists with the world context
      await runtime.ensureRoomExists({
        id: agentRoomId,
        agentId: runtime.agentId,
        serverId: "00000000-0000-0000-0000-000000000000",
        worldId: agentWorldId,
        name: "test-conversation-room",
        source: "test",
        type: ChannelType.WORLD,
      });

      if (process.env.TEST_LOG_LEVEL === "debug") {
        console.log(`✅ Successfully set up world and room for ${agentName}`);
      }
    } catch (error) {
      console.log(`❌ Failed to ensure room exists for ${agentName}:`, error);
      // Don't throw - let the test continue but with a warning
    }

    // Set up model mocking
    if (this.modelMockingService) {
      // Use comprehensive model mocking service
      const cleanup = this.modelMockingService.patchRuntime(runtime, agentName);
      this.runtimeCleanupFunctions.set(agentName, cleanup);
    } else {
      // Fall back to legacy model mocking
      const mockConfig = this.modelMocks.get(agentName);
      if (mockConfig) {
        this.setupModelMock(runtime, mockConfig);
      }
    }

    this.runtimes.set(agentName, runtime);
    return runtime;
  }

  /**
   * Set up model response mocking for an agent
   */
  private setupModelMock(
    runtime: IAgentRuntime,
    mockConfig: ModelMockConfig
  ): void {
    const originalUseModel = runtime.useModel;

    runtime.useModel = vi
      .fn()
      .mockImplementation(async (modelType: string, options: any) => {
        const responseIndex = this.responseIndices.get(mockConfig.agentId) || 0;

        if (mockConfig.recordMode) {
          // In record mode, call actual model and save response
          const actualResponse = await originalUseModel.call(
            runtime,
            modelType,
            options
          );
          // TODO: Save to recording file
          return actualResponse;
        } else {
          // In playback mode, return mocked response
          if (responseIndex < mockConfig.responses.length) {
            const response = mockConfig.responses[responseIndex];
            this.responseIndices.set(mockConfig.agentId, responseIndex + 1);
            return JSON.stringify({ text: response });
          } else {
            return JSON.stringify({
              text: "No more mocked responses available",
            });
          }
        }
      });
  }

  /**
   * Send a message from one agent to the conversation
   * @param fromAgent - Name of the agent sending the message
   * @param toAgents - Names of agents to send to (or channel participants)
   * @param content - Message content
   * @param responseConfig - Response configuration (replaces shouldTriggerResponses)
   * @param channelId - Optional channel ID (defaults to default channel)
   */
  async sendMessage(
    fromAgent: string,
    toAgents: string[],
    content: string,
    responseConfig?: ResponseConfig | boolean, // Support both new and old API
    channelId?: UUID
  ): Promise<{
    message: ConversationMessage;
    responses: AgentResponseResult[];
  }> {
    if (!this.defaultChannelId) {
      throw new Error("Simulator not initialized - no channel available");
    }

    const fromRuntime = this.runtimes.get(fromAgent);
    if (!fromRuntime) {
      throw new Error(`Agent ${fromAgent} not found`);
    }

    // Increment message sequence for deterministic ordering
    this.messageSequence++;
    const deterministicTimestamp =
      (this.testStartTime || Date.now()) + this.messageSequence * 1000;

    // Use specified channel or default
    const targetChannelId = channelId || this.defaultChannelId!;
    const channel = this.channels.get(targetChannelId);
    if (!channel) {
      throw new Error(`Channel ${targetChannelId} not found`);
    }

    // Check if channel is exhausted
    if (this.isChannelExhausted(targetChannelId)) {
      throw new Error(
        `Channel ${channel.name} is exhausted (reached message limit or timeout)`
      );
    }

    // For backward compatibility, if using default channel and sender not in participants, add them
    if (
      targetChannelId === this.defaultChannelId &&
      !channel.participants.has(fromAgent)
    ) {
      channel.participants.set(fromAgent, ParticipantMode.READ_WRITE);
    }

    // Also add toAgents if they're not already participants (backward compatibility)
    if (targetChannelId === this.defaultChannelId) {
      toAgents.forEach((agentName) => {
        if (!channel.participants.has(agentName) && agentName !== fromAgent) {
          channel.participants.set(agentName, ParticipantMode.READ_WRITE);
        }
      });
    }

    // Check if sender can send to this channel
    const senderMode = channel.participants.get(fromAgent);
    if (!senderMode) {
      throw new Error(
        `Agent ${fromAgent} is not a participant in channel ${channel.name}`
      );
    }
    if (senderMode === ParticipantMode.OBSERVE_ONLY) {
      throw new Error(
        `Agent ${fromAgent} is observe-only in channel ${channel.name}`
      );
    }

    // Create the message
    const authorId = fromRuntime.agentId;
    const message = await this.server.createMessage({
      channelId: targetChannelId,
      authorId,
      content,
    });

    const conversationMessage: ConversationMessage = {
      id: message.id,
      authorId,
      authorName: fromAgent,
      content,
      timestamp: deterministicTimestamp, // Use deterministic timestamp
      channelId: targetChannelId,
    };

    // Add to channel messages
    channel.messages.push(conversationMessage);

    // Notify channel observers
    channel.observers.forEach((observer) => {
      try {
        observer(conversationMessage);
      } catch (error) {
        console.warn("Channel observer error:", error);
      }
    });

    // Add to global message history for backward compatibility
    this.messageHistory.push(conversationMessage);

    // Handle response configuration
    let responses: AgentResponseResult[] = [];
    let maxReplies: number | undefined;
    let shouldTriggerResponses = false;

    if (typeof responseConfig === "boolean") {
      // Backward compatibility: boolean -> maxReplies
      maxReplies = responseConfig ? 1 : undefined;
      shouldTriggerResponses = responseConfig;
    } else if (responseConfig) {
      maxReplies = responseConfig.maxReplies;
      shouldTriggerResponses = maxReplies !== undefined && maxReplies > 0;
    }

    if (shouldTriggerResponses && maxReplies !== undefined) {
      // Determine eligible responders based on channel participants and modes
      const eligibleResponders = toAgents.filter((agentName) => {
        const mode = channel.participants.get(agentName);
        return mode === ParticipantMode.READ_WRITE; // Only read-write participants can respond
      });

      if (eligibleResponders.length > 0) {
        // Check if we have capacity for more messages
        const remainingCapacity = channel.maxMessages
          ? channel.maxMessages - channel.messages.length
          : Infinity;
        const actualMaxReplies = Math.min(maxReplies, remainingCapacity);

        if (actualMaxReplies > 0) {
          responses = await this.triggerAgentResponses({
            excludeAgents: [fromAgent], // Don't trigger response for the sender
            includeAgents: eligibleResponders,
            maxReplies: actualMaxReplies,
            channelId: targetChannelId,
          });
        }
      }
    }

    return { message: conversationMessage, responses };
  }

  private async ensureWorldAndRoomExist(
    runtime: IAgentRuntime
  ): Promise<{ agentWorldId: UUID; agentRoomId: UUID }> {
    if (!this.defaultChannelId) {
      throw new Error("Simulator not initialized - no channel available");
    }
    const agentWorldId = createUniqueUuid(
      runtime,
      "00000000-0000-0000-0000-000000000000"
    );
    const agentRoomId = createUniqueUuid(runtime, this.defaultChannelId);

    try {
      await runtime.ensureWorldExists({
        id: agentWorldId,
        name: "Test World",
        agentId: runtime.agentId,
        serverId: "00000000-0000-0000-0000-000000000000",
        metadata: {},
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message &&
        error.message.includes("worlds_pkey")
      ) {
        if (process.env.TEST_LOG_LEVEL === "debug") {
          console.log(
            `[${runtime.character.name}] MessageBusService: World ${agentWorldId} already exists, continuing with message processing`
          );
        }
      } else {
        throw error;
      }
    }

    try {
      await runtime.ensureRoomExists({
        id: agentRoomId,
        name: "Test Room",
        agentId: runtime.agentId,
        worldId: agentWorldId,
        channelId: this.defaultChannelId,
        serverId: "00000000-0000-0000-0000-000000000000",
        source: "central-bus",
        type: ChannelType.GROUP,
        metadata: {},
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message &&
        error.message.includes("rooms_pkey")
      ) {
        if (process.env.TEST_LOG_LEVEL === "debug") {
          console.log(
            `[${runtime.character.name}] MessageBusService: Room ${agentRoomId} already exists, continuing with message processing`
          );
        }
      } else {
        throw error;
      }
    }

    return { agentWorldId, agentRoomId };
  }

  /**
   * Trigger other agents to potentially respond to the latest message using proper event system
   * Returns results that can be tested/asserted
   */
  private async triggerAgentResponses({
    excludeAgents = [],
    includeAgents = [],
    maxReplies = 1,
    channelId,
  }: {
    includeAgents?: string[];
    excludeAgents?: string[];
    maxReplies?: number;
    channelId?: UUID;
  }): Promise<AgentResponseResult[]> {
    // Sort agents for deterministic processing order
    const otherAgents = Array.from(this.runtimes.keys())
      .filter(
        (name) =>
          excludeAgents.every((e) => e !== name) &&
          (excludeAgents.length > 0 || includeAgents.includes(name))
      )
      .sort(); // Alphabetical order for consistency

    const results: AgentResponseResult[] = [];
    const baseTimestamp = this.testStartTime || Date.now();

    // Process agents sequentially to avoid race conditions
    for (let i = 0; i < otherAgents.length; i++) {
      const agentName = otherAgents[i];
      const runtime = this.runtimes.get(agentName);
      if (!runtime) {
        results.push({
          agentName,
          responded: false,
          modelCalls: 0,
          error: "Runtime not available",
        });
        continue;
      }

      try {
        // Create memory object for the latest message with deterministic ID
        const latestMessage =
          this.messageHistory[this.messageHistory.length - 1];

        // Use deterministic memory ID instead of random
        const memoryId = stringToUuid(
          `msg-${baseTimestamp}-${this.messageSequence}-${agentName}-${i}`
        );

        const memory: Memory = {
          id: memoryId,
          entityId: latestMessage.authorId,
          agentId: runtime.agentId,
          roomId: createUniqueUuid(runtime, this.defaultChannelId),
          content: {
            text: latestMessage.content,
            source: "test",
          },
          metadata: {
            timestamp: latestMessage.timestamp,
            type: "message",
            sequence: this.messageSequence,
            agentProcessingOrder: i,
            authorName: latestMessage.authorName, // Include author name for proper resolution
          },
          createdAt: latestMessage.timestamp,
        };

        if (process.env.TEST_LOG_LEVEL === "debug") {
          console.log(
            `Triggering ${agentName} (${i + 1}/${otherAgents.length}) to process message: "${latestMessage.content}"`
          );
        }

        // Track response data
        const result: AgentResponseResult = {
          agentName,
          responded: false,
          modelCalls: 0,
        };

        // Get initial model call count
        const initialStats = this.modelMockingService?.getResponseStats();
        const initialCalls = initialStats?.totalCalls || 0;

        // Emit MESSAGE_RECEIVED event - this triggers the full 2-step evaluation
        // The bootstrap plugin will handle shouldRespond + action selection
        await runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
          runtime,
          message: memory,
          callback: async (response: Content) => {
            if (process.env.TEST_LOG_LEVEL === "debug") {
              console.log(`${agentName} generated response:`, {
                text: response.text,
                actions: response.actions,
                thought: response.thought,
              });
            }

            if (
              response &&
              response.text &&
              !response.actions?.includes("IGNORE")
            ) {
              result.responded = true;
              result.response = response.text;
              // Create agent response message (don't trigger more responses to avoid recursion)
              await this.sendMessage(
                agentName,
                otherAgents,
                response.text,
                false
              );
            } else if (response.actions?.includes("IGNORE")) {
              if (process.env.TEST_LOG_LEVEL === "debug") {
                console.log(`${agentName} decided to ignore the message`);
              }
            }
          },
          onComplete: () => {
            if (process.env.TEST_LOG_LEVEL === "debug") {
              console.log(`${agentName} completed processing message`);
            }
          },
        });

        // Give the agent time to process with deterministic delay
        // Use much shorter delays in playback mode for better performance
        const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
        const baseDelay = isRecordMode ? 100 : 10; // Reduce delay in playback mode
        const staggerDelay = isRecordMode ? 50 : 5; // Minimal stagger in playback
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay + i * staggerDelay)
        );

        // Calculate model calls made
        const finalStats = this.modelMockingService?.getResponseStats();
        const finalCalls = finalStats?.totalCalls || 0;
        result.modelCalls = finalCalls - initialCalls;

        results.push(result);

        if (process.env.TEST_LOG_LEVEL === "debug") {
          console.log(
            `${agentName} ${result.responded ? "provided a response" : "did not respond"} (${result.modelCalls} model calls)`
          );
        }
      } catch (error) {
        if (process.env.TEST_LOG_LEVEL === "debug") {
          console.log(
            `Failed to trigger response for agent ${agentName}:`,
            error
          );
        }
        results.push({
          agentName,
          responded: false,
          modelCalls: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get the conversation history
   */
  getConversationHistory(): ConversationMessage[] {
    return [...this.messageHistory];
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
   * Wait for a specified number of messages to be exchanged
   */
  async waitForMessages(
    expectedCount: number,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    const startTime = Date.now();

    // Use shorter timeouts and poll intervals in playback mode
    const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
    const effectiveTimeout = isRecordMode
      ? timeoutMs
      : Math.min(timeoutMs, 3000);
    const pollInterval = isRecordMode ? 100 : 20;

    while (
      this.messageHistory.length < expectedCount &&
      Date.now() - startTime < effectiveTimeout
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const success = this.messageHistory.length >= expectedCount;
    if (!success && !isRecordMode) {
      console.warn(
        `⚠️ waitForMessages timeout: expected ${expectedCount}, got ${this.messageHistory.length} (timeout: ${effectiveTimeout}ms)`
      );
    }

    return success;
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

    // Save recordings if using model mocking service
    if (this.modelMockingService) {
      await this.modelMockingService.saveRecordings();
    }

    await this.server.stop();
    this.runtimes.clear();
    this.messageHistory = [];
  }

  /**
   * Save conversation to file for later analysis
   */
  async saveConversation(filePath: string): Promise<void> {
    const fs = await import("fs/promises");
    const conversationData = {
      timestamp: new Date().toISOString(),
      agents: this.getAgentNames(),
      messages: this.messageHistory,
      config: this.config,
    };

    await fs.writeFile(filePath, JSON.stringify(conversationData, null, 2));
  }

  /**
   * Create a summary of the conversation for analysis
   */
  createConversationSummary(): {
    messageCount: number;
    participantCount: number;
    averageMessageLength: number;
    messagesByAgent: Record<string, number>;
  } {
    const messagesByAgent: Record<string, number> = {};
    let totalLength = 0;

    for (const message of this.messageHistory) {
      messagesByAgent[message.authorName] =
        (messagesByAgent[message.authorName] || 0) + 1;
      totalLength += message.content.length;
    }

    return {
      messageCount: this.messageHistory.length,
      participantCount: this.getAgentNames().length,
      averageMessageLength:
        this.messageHistory.length > 0
          ? totalLength / this.messageHistory.length
          : 0,
      messagesByAgent,
    };
  }

  /**
   * Get model mocking service for advanced testing
   */
  getModelMockingService(): ModelMockingService | undefined {
    return this.modelMockingService;
  }

  /**
   * Set test context for model recording organization
   */
  setTestContext(suiteName: string, testName: string): void {
    if (this.modelMockingService) {
      this.modelMockingService.setTestContext(suiteName, testName);
    }
  }

  /**
   * Inspect the current state of an agent by calling runtime.composeState
   * This is useful for debugging game state issues
   */
  async inspectAgentState(agentName: string): Promise<State> {
    const runtime = this.runtimes.get(agentName);
    if (!runtime) {
      throw new Error(`Agent ${agentName} not found`);
    }

    if (!this.defaultChannelId) {
      throw new Error("Simulator not initialized - no channel available");
    }

    // Create a dummy message for state composition
    const dummyMessage = {
      id: stringToUuid(`dummy-${Date.now()}`),
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      roomId: this.defaultChannelId,
      createdAt: Date.now(),
      content: { text: "State inspection" },
      type: MemoryType.MESSAGE,
      metadata: { entityName: agentName, type: MemoryType.MESSAGE },
    };

    try {
      // Use runtime.composeState to get composed state from all providers
      const composedState = await runtime.composeState(dummyMessage);
      return composedState;
    } catch (error) {
      throw new Error(
        `Failed to compose state for agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Helper method to specifically inspect House game state
   */
  async inspectHouseGameState(): Promise<State> {
    return await this.inspectAgentState("House");
  }

  public getCurrentChannelId(): UUID | undefined {
    return this.defaultChannelId;
  }

  /**
   * Get a specific channel by ID
   */
  public getChannel(channelId: UUID): Channel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels
   */
  public getChannels(): Map<UUID, Channel> {
    return new Map(this.channels);
  }

  /**
   * Get messages from a specific channel
   */
  public getChannelMessages(channelId: UUID): ConversationMessage[] {
    const channel = this.channels.get(channelId);
    return channel ? [...channel.messages] : [];
  }

  /**
   * Wait for a specific number of messages in a channel
   */
  public async waitForChannelMessages(
    channelId: UUID,
    expectedCount: number,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    const startTime = Date.now();
    const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
    const effectiveTimeout = isRecordMode
      ? timeoutMs
      : Math.min(timeoutMs, 3000);
    const pollInterval = isRecordMode ? 100 : 20;

    while (
      channel.messages.length < expectedCount &&
      Date.now() - startTime < effectiveTimeout
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const success = channel.messages.length >= expectedCount;
    if (!success && !isRecordMode) {
      console.warn(
        `⚠️ waitForChannelMessages timeout: expected ${expectedCount}, got ${channel.messages.length} (timeout: ${effectiveTimeout}ms)`
      );
    }

    return success;
  }

  /**
   * Create a one-on-one channel between two agents
   */
  public async createPrivateChannel(
    agent1: string,
    agent2: string
  ): Promise<UUID> {
    return await this.createChannel({
      name: `private-${agent1}-${agent2}`,
      participants: [agent1, agent2],
    });
  }

  /**
   * Create a broadcast channel where one agent sends and others only receive
   */
  public async createBroadcastChannel(
    broadcaster: string,
    receivers: string[],
    channelName?: string
  ): Promise<UUID> {
    const participants: ChannelParticipant[] = [
      { agentName: broadcaster, mode: ParticipantMode.BROADCAST_ONLY },
      ...receivers.map((name) => ({
        agentName: name,
        mode: ParticipantMode.READ_WRITE,
      })),
    ];

    return this.createChannel({
      name: channelName || `broadcast-${broadcaster}`,
      participants,
    });
  }
}
