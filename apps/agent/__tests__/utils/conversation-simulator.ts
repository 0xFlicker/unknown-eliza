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
} from "@elizaos/core";
import {
  ModelMockingService,
  type AgentResponseResult,
} from "./model-mocking-service";

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
  private messageHistory: ConversationMessage[] = [];
  private currentChannel?: UUID;
  private currentWorld?: UUID;
  private modelMocks: Map<string, ModelMockConfig> = new Map();
  private responseIndices: Map<string, number> = new Map();
  private modelMockingService?: ModelMockingService;
  private runtimeCleanupFunctions: Map<string, () => void> = new Map();

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
    // Initialize server
    await this.server.initialize({ dataDir: this.config.dataDir });

    // Create test server and channel
    const msgSrv = await this.server.createServer({
      name: "test-conversation-server",
      sourceType: "test",
    });

    const channel = await this.server.createChannel({
      messageServerId: msgSrv.id,
      name: "test-conversation-room",
      type: ChannelType.GROUP,
    });
    this.currentChannel = channel.id;

    // Start server if port specified
    if (this.config.serverPort) {
      this.server.start(this.config.serverPort);
    }
  }

  /**
   * Add an agent runtime to the conversation
   */
  async addAgent(
    agentName: string,
    character: any,
    plugins: any[] = []
  ): Promise<IAgentRuntime> {
    // Filter out local-ai plugin in playback mode to prevent actual model calls
    let filteredPlugins = plugins;
    if (!process.env.MODEL_RECORD_MODE && this.modelMockingService) {
      // Remove local-ai plugin to prevent actual inference during playback
      filteredPlugins = plugins.filter(plugin => {
        const pluginName = plugin.name || plugin.constructor?.name || '';
        return !pluginName.toLowerCase().includes('localai') && 
               !pluginName.toLowerCase().includes('local-ai');
      });
      
      if (filteredPlugins.length !== plugins.length) {
        console.log(`🚫 Disabled local-ai plugin for ${agentName} in playback mode`);
      }
    }

    const runtime = new AgentRuntime({
      character: { ...character, name: agentName },
      plugins: filteredPlugins,
      settings: { DATABASE_PATH: this.config.dataDir },
    });

    await runtime.initialize();
    await this.server.registerAgent(runtime);

    // Create and ensure world and room exist for this agent
    if (this.currentChannel) {
      try {
        // Create a world for this agent if not already created
        if (!this.currentWorld) {
          this.currentWorld = stringToUuid(`test-world-${Date.now()}`);
        }

        // Ensure the world exists in the agent's database
        await runtime.ensureWorldExists({
          id: this.currentWorld,
          agentId: runtime.agentId,
          serverId: "00000000-0000-0000-0000-000000000000",
        });

        // Now ensure the room exists with the world context
        await runtime.ensureRoomExists({
          id: this.currentChannel,
          agentId: runtime.agentId,
          serverId: "00000000-0000-0000-0000-000000000000",
          worldId: this.currentWorld,
          name: "test-conversation-room",
          source: "test",
          type: ChannelType.GROUP,
        });

        console.log(`✅ Successfully set up world and room for ${agentName}`);
      } catch (error) {
        console.log(`❌ Failed to ensure room exists for ${agentName}:`, error);
        // Don't throw - let the test continue but with a warning
      }
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
   */
  async sendMessage(
    fromAgent: string,
    content: string,
    shouldTriggerResponses: boolean = true
  ): Promise<{
    message: ConversationMessage;
    responses: AgentResponseResult[];
  }> {
    if (!this.currentChannel) {
      throw new Error("Simulator not initialized - no channel available");
    }

    const runtime = this.runtimes.get(fromAgent);
    if (!runtime) {
      throw new Error(`Agent ${fromAgent} not found`);
    }

    // Create the message
    const authorId = runtime.agentId;
    const message = await this.server.createMessage({
      channelId: this.currentChannel,
      authorId,
      content,
    });

    const conversationMessage: ConversationMessage = {
      id: message.id,
      authorId,
      authorName: fromAgent,
      content,
      timestamp: Date.now(),
      channelId: this.currentChannel,
    };

    this.messageHistory.push(conversationMessage);

    // Optionally trigger other agents to respond
    let responses: AgentResponseResult[] = [];
    if (shouldTriggerResponses) {
      responses = await this.triggerAgentResponses(fromAgent);
    }

    return { message: conversationMessage, responses };
  }

  /**
   * Trigger other agents to potentially respond to the latest message using proper event system
   * Returns results that can be tested/asserted
   */
  private async triggerAgentResponses(
    excludeAgent: string
  ): Promise<AgentResponseResult[]> {
    const otherAgents = Array.from(this.runtimes.keys()).filter(
      (name) => name !== excludeAgent
    );

    const results: AgentResponseResult[] = [];

    // Process agents sequentially to avoid race conditions
    for (const agentName of otherAgents) {
      const runtime = this.runtimes.get(agentName);
      if (!runtime || !this.currentChannel) {
        results.push({
          agentName,
          responded: false,
          modelCalls: 0,
          error: "Runtime or channel not available",
        });
        continue;
      }

      try {
        // Create memory object for the latest message
        const latestMessage =
          this.messageHistory[this.messageHistory.length - 1];
        const memory: Memory = {
          id: stringToUuid(`msg-${Date.now()}-${Math.random()}`),
          entityId: latestMessage.authorId,
          agentId: runtime.agentId,
          roomId: this.currentChannel,
          content: {
            text: latestMessage.content,
            source: "test",
          },
          metadata: {
            timestamp: latestMessage.timestamp,
            type: "message",
          },
          createdAt: latestMessage.timestamp,
        };

        console.log(
          `Triggering ${agentName} to process message: "${latestMessage.content}"`
        );

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
            console.log(`${agentName} generated response:`, {
              text: response.text,
              actions: response.actions,
              thought: response.thought,
            });

            if (
              response &&
              response.text &&
              !response.actions?.includes("IGNORE")
            ) {
              result.responded = true;
              result.response = response.text;
              // Create agent response message (don't trigger more responses to avoid recursion)
              const messageResult = await this.sendMessage(
                agentName,
                response.text,
                false
              );
            } else if (response.actions?.includes("IGNORE")) {
              console.log(`${agentName} decided to ignore the message`);
            }
          },
          onComplete: () => {
            console.log(`${agentName} completed processing message`);
          },
        });

        // Give the agent time to process (including potential model cold startup)
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Calculate model calls made
        const finalStats = this.modelMockingService?.getResponseStats();
        const finalCalls = finalStats?.totalCalls || 0;
        result.modelCalls = finalCalls - initialCalls;

        results.push(result);

        console.log(
          `${agentName} ${result.responded ? "provided a response" : "did not respond"} (${result.modelCalls} model calls)`
        );
      } catch (error) {
        console.log(
          `Failed to trigger response for agent ${agentName}:`,
          error
        );
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

    while (
      this.messageHistory.length < expectedCount &&
      Date.now() - startTime < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.messageHistory.length >= expectedCount;
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
}
