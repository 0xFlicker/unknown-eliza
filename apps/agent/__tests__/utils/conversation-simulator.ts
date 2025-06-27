import { vi } from "vitest";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
  Content,
  stringToUuid,
  type IAgentRuntime,
  type Memory,
  type UUID,
} from "@elizaos/core";

/**
 * Configuration for model response mocking
 */
export interface ModelMockConfig {
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
  /** Model mocking configurations */
  modelMocks?: ModelMockConfig[];
  /** Test data directory */
  dataDir: string;
  /** Server port for testing */
  serverPort?: number;
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
  private modelMocks: Map<string, ModelMockConfig> = new Map();
  private responseIndices: Map<string, number> = new Map();

  constructor(private config: SimulatorConfig) {
    this.server = new AgentServer();

    // Set up model mocks
    config.modelMocks?.forEach((mock) => {
      this.modelMocks.set(mock.agentId, mock);
      this.responseIndices.set(mock.agentId, 0);
    });
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
    const runtime = new AgentRuntime({
      character: { ...character, name: agentName },
      plugins,
      settings: { DATABASE_PATH: this.config.dataDir },
    });

    await runtime.initialize();
    await this.server.registerAgent(runtime);

    // Set up model mocking if configured
    const mockConfig = this.modelMocks.get(agentName);
    if (mockConfig) {
      this.setupModelMock(runtime, mockConfig);
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

    runtime.useModel = vi.fn().mockImplementation(async (...args) => {
      const responseIndex = this.responseIndices.get(mockConfig.agentId) || 0;

      if (mockConfig.recordMode) {
        // In record mode, call actual model and save response
        const actualResponse = await originalUseModel.apply(runtime, args);
        // TODO: Save to recording file
        return actualResponse;
      } else {
        // In playback mode, return mocked response
        if (responseIndex < mockConfig.responses.length) {
          const response = mockConfig.responses[responseIndex];
          this.responseIndices.set(mockConfig.agentId, responseIndex + 1);
          return JSON.stringify({ text: response });
        } else {
          return JSON.stringify({ text: "No more mocked responses available" });
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
  ): Promise<ConversationMessage> {
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
    if (shouldTriggerResponses) {
      await this.triggerAgentResponses(fromAgent);
    }

    return conversationMessage;
  }

  /**
   * Trigger other agents to potentially respond to the latest message
   */
  private async triggerAgentResponses(excludeAgent: string): Promise<void> {
    const otherAgents = Array.from(this.runtimes.keys()).filter(
      (name) => name !== excludeAgent
    );

    for (const agentName of otherAgents) {
      const runtime = this.runtimes.get(agentName);
      if (!runtime || !this.currentChannel) continue;

      try {
        // Create memory object for the latest message
        const latestMessage =
          this.messageHistory[this.messageHistory.length - 1];
        const memory: Memory = {
          entityId: latestMessage.authorId,
          roomId: this.currentChannel,
          content: {
            text: latestMessage.content,
            source: "test",
          },
          metadata: {
            timestamp: latestMessage.timestamp,
            type: "message",
          },
        };

        // Build state and try to process actions
        const state = await runtime.composeState(memory);

        // Try each available action
        for (const action of runtime.actions || []) {
          try {
            const isValid = await action.validate(runtime, memory, state);
            if (isValid) {
              await action.handler(
                runtime,
                memory,
                state,
                {},
                async (response: Content) => {
                  if (response && response.text) {
                    // Create agent response message
                    await this.sendMessage(agentName, response.text, false);
                  }
                  return [];
                }
              );
              break; // Only use first valid action
            }
          } catch (actionError) {
            console.log(
              `Action ${action.name} failed for agent ${agentName}:`,
              actionError
            );
          }
        }
      } catch (error) {
        console.log(
          `Failed to trigger response for agent ${agentName}:`,
          error
        );
      }
    }
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
    for (const runtime of this.runtimes.values()) {
      // Clean up runtime if needed
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
}
