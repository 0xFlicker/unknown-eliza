import { vi } from "vitest";
import dotenv from "dotenv";
import { AgentServer, internalMessageBus } from "@elizaos/server";
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
  logger,
} from "@elizaos/core";
import {
  ModelMockingService,
  type AgentResponseResult,
} from "./model-mocking-service";
import { GameStatePreloader } from "./game-state-preloader";
import { Phase, GameSettings } from "../../src/plugins/house/types";
import fs from "fs";
import { randomUUID } from "crypto";
import {
  GameEventType,
  GameEventPayloadMap,
  GameEventHandler,
  PhaseTransitionPayload,
  PhaseEventPayload,
  PlayerReadyPayload,
  AllPlayersReadyPayload,
  TimerEventPayload,
  StrategicThinkingPayload,
  DiaryRoomPayload,
  GameStateChangePayload,
} from "../../src/plugins/house/events/types";
import {
  AnyCoordinationMessage,
  MessageServiceMessage,
} from "../../src/plugins/coordinator/types";
import { CoordinationService } from "src/plugins/coordinator/service";

/**
 * Coordination event for tracking cross-agent communication
 */
export interface CoordinationEvent {
  type: string;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others";
  timestamp: number;
  payload: any;
  messageId: string;
}

/**
 * Event matcher function for flexible event waiting
 */
export type EventMatcher = (events: ConversationMessageV3[]) => boolean;

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
  coordinationEvent?: CoordinationEvent;
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
  /** Custom game settings to override defaults */
  settings?: Partial<GameSettings>;
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
  room?: {
    type: ChannelType;
    name: string;
  };
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
  allowReplyToMessages?:
    | false
    | ((message: ConversationMessageV3, messageCount: number) => boolean);
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
 * Game event observer function type
 */
export type GameEventObserver<
  T extends keyof GameEventPayloadMap = keyof GameEventPayloadMap,
> = (eventType: T, payload: GameEventPayloadMap[T]) => void | Promise<void>;

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
  private gameEventObservers: GameEventObserver[] = [];
  private runtimeEventListeners: Map<string, Array<() => void>> = new Map();

  // Coordination event tracking
  private coordinationEvents: CoordinationEvent[] = [];
  private eventCounts = new Map<string, number>();
  private coordinationChannelId?: UUID;

  constructor(private config: SimulatorConfigV3) {
    process.env.SERVER_PORT = config.serverPort?.toString() || "3100";
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

    // CRITICAL: Subscribe to AgentServer's internalMessageBus to capture coordination messages
    const messageHandler = async (messageForBus: MessageServiceMessage) => {
      const message = messageForBus;
      if (!messageForBus.raw_message) {
        return;
      }
      if (this.channels.has(message.channel_id)) {
        const channel = this.channels.get(message.channel_id);
        if (channel) {
          const conversationMessage: ConversationMessageV3 = {
            authorId: message.author_id,
            authorName:
              message.metadata?.agentName ||
              this.getAgentNameById(message.author_id) ||
              "Unknown",
            content: message.content,
            timestamp: new Date(message.created_at).getTime(),
            channelId: message.channel_id,
            actions: message.metadata?.actions || [],
            thought: message.metadata?.thought || "",
            providers: message.metadata?.providers || [],
            metadata: message.metadata,
          };
          console.log(
            `📩 Captured message via AgentServer message bus: ${JSON.stringify(
              conversationMessage
            )}`
          );
          channel.messages.push(conversationMessage);

          // First: Create memories for all participants who should receive this message
          // for (const [participant, mode] of channel.participants.entries()) {
          //   if (participant === message.metadata?.agentName) continue;
          //   // get our default room id for this participant
          //   const runtime = this.runtimes.get(participant);
          //   if (runtime && mode === ParticipantModeV3.READ_WRITE) {
          //     const worldId = createUniqueUuid(runtime, this.testServer!.id);
          //     const roomId = createUniqueUuid(runtime, channel.id);
          //     const memory: Memory = {
          //       id: createUniqueUuid(runtime, message.id),
          //       entityId: createUniqueUuid(runtime, message.author_id),
          //       agentId: runtime.agentId,
          //       worldId,
          //       content: {
          //         text: message.content,
          //         thought: message.metadata?.thought,
          //         actions: message.metadata?.actions,
          //         inReplyTo: message.metadata?.inReplyTo,
          //         channelType: channel.type,
          //         providers: message.metadata?.providers,
          //         source: "test-simulator-v3",
          //         target: message.metadata?.target,
          //         url: message.metadata?.url,
          //       },
          //       roomId,
          //       createdAt: conversationMessage.timestamp,
          //       metadata: message.metadata,
          //     };
          //     await runtime.createMemory(memory, "messages");
          //   }
          // }

          // Second: Send message to all participants who should respond (separate from memory creation)
          const authorId = message.author_id;
          const runtime = this.runtimes.get(message.metadata?.agentName);
          if (!runtime) {
            console.warn(
              `Agent ${message.metadata?.agentName} runtime not found`
            );
            return;
          }

          // If agent decides to IGNORE or has no valid text, skip sending response
          const shouldSkip =
            message.metadata?.actions?.includes("IGNORE") ||
            !message.content ||
            message.content.trim() === "";

          if (shouldSkip) {
            logger.info(
              `[${message.metadata?.agentName}] ConversationSimulatorV3: Skipping response (reason: ${message.metadata?.actions?.includes("IGNORE") ? "IGNORE action" : "No text"})`
            );
            return;
          }

          // Resolve reply-to message ID from agent memory metadata
          let centralInReplyToRootMessageId: UUID | undefined = undefined;
          if (message.metadata?.sourceId) {
            centralInReplyToRootMessageId = message.metadata.sourceId as UUID;
          }

          const baseUrl = `http://localhost:${this.config.serverPort}`;
          const payloadToServer = {
            channel_id: channel.id,
            server_id: this.testServer!.id,
            author_id: authorId,
            content: message.content,
            in_reply_to_message_id: centralInReplyToRootMessageId,
            source_type: "agent_response",
            raw_message: {
              text: message.content,
            },
            metadata: {
              agent_id: authorId,
              agentName: runtime.character.name,
              attachments: [],
              channelType: channel.type,
              isDm: channel.type === ChannelType.DM,
            },
          };
          // await fetch(`${baseUrl}/api/messaging/submit`, {
          //   method: "POST",
          //   headers: {
          //     "Content-Type": "application/json",
          //   },
          //   body: JSON.stringify(payloadToServer),
          // });
          if (message.channel_id === this.coordinationChannelId) {
            this.trackCoordinationMessage(conversationMessage);
          }
        }
      }
    };

    // Subscribe to the internal message bus
    internalMessageBus.on("new_message", messageHandler);

    // Store the subscription for cleanup
    this.busSubscriptions.set("internal-message-handler", messageHandler);
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
  public getAgentNameById(agentId: UUID): string | undefined {
    for (const [name, runtime] of this.runtimes.entries()) {
      if (runtime.agentId === agentId) {
        return name;
      }
    }
    return undefined;
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
    const worldId = createUniqueUuid(houseRuntime, this.testServer!.id);

    await houseRuntime.ensureWorldExists({
      id: worldId,
      name: "Game World",
      agentId: houseRuntime.agentId,
      serverId: this.testServer!.id,
    });

    await houseRuntime.ensureRoomExists({
      id: roomId,
      name: `game-channel-${gameStateConfig.phase.toLowerCase()}`,
      agentId: houseRuntime.agentId,
      worldId: worldId,
      channelId: channelId,
      serverId: this.testServer!.id,
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
          settings: gameStateConfig.settings,
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
   * Get the coordination channel ID
   */
  public getCoordinationChannelId(): UUID {
    return this.coordinationChannelId;
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
   * Subscribe to game events for test synchronization
   * This connects to the actual ElizaOS runtime event system
   */
  observeGameEvents(observer: GameEventObserver): () => void {
    this.gameEventObservers.push(observer);

    // Register event listeners on existing runtimes
    this.registerGameEventListenersOnExistingRuntimes();

    // Return unsubscribe function
    return () => {
      const index = this.gameEventObservers.indexOf(observer);
      if (index > -1) {
        this.gameEventObservers.splice(index, 1);
      }
    };
  }

  /**
   * Register game event listeners on all existing runtimes
   */
  private registerGameEventListenersOnExistingRuntimes(): void {
    for (const [agentName, runtime] of this.runtimes.entries()) {
      this.registerGameEventListenersOnSingleRuntime(agentName, runtime);
    }
  }

  /**
   * Register game event listeners on a single runtime
   */
  private registerGameEventListenersOnSingleRuntime(
    agentName: string,
    runtime: IAgentRuntime
  ): void {
    // Skip if already registered
    if (this.runtimeEventListeners.has(agentName)) {
      return;
    }

    // List of game events to listen for
    const gameEventTypes = [
      GameEventType.PHASE_TRANSITION_INITIATED,
      GameEventType.PHASE_STARTED,
      GameEventType.PHASE_ENDED,
      GameEventType.PLAYER_READY,
      GameEventType.ALL_PLAYERS_READY,
      GameEventType.TIMER_WARNING,
      GameEventType.TIMER_EXPIRED,
      GameEventType.STRATEGIC_THINKING_REQUIRED,
      GameEventType.STRATEGIC_THINKING_COMPLETED,
      GameEventType.DIARY_ROOM_OPENED,
      GameEventType.DIARY_ROOM_COMPLETED,
      GameEventType.GAME_STATE_CHANGED,
      GameEventType.ROUND_STARTED,
      GameEventType.ROUND_ENDED,
    ];

    for (const eventType of gameEventTypes) {
      const listener = async (payload: any) => {
        console.log(`🎮 [${agentName}] Received event: ${eventType}`);
        await this.handleGameEvent(
          eventType as keyof GameEventPayloadMap,
          payload
        );
      };

      // Register the listener

      runtime.registerEvent(eventType, listener);
      console.log(
        `📡 Registered listener for ${eventType} on ${agentName} runtime`
      );
    }
  }

  /**
   * Emit a game event to all observers (receives events from actual game)
   */
  async handleGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    payload: GameEventPayloadMap[T]
  ): Promise<void> {
    // Notify all observers
    for (const observer of this.gameEventObservers) {
      try {
        await observer(eventType, payload);
      } catch (error) {
        console.warn(`Error in game event observer for ${eventType}:`, error);
      }
    }
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
    console.log(`Adding agent ${agentName}...`);
    const runtime = new AgentRuntime({
      character: { ...character, name: agentName },
      plugins,
      settings: {
        ...testEnv.parsed,
        DATABASE_PATH: this.config.dataDir,
        LOG_LEVEL: "info",
      },
    });

    await runtime.initialize();
    await this.server.registerAgent(runtime);
    if (this.modelMockingService) {
      const cleanup = this.modelMockingService.patchRuntime(runtime, agentName);
      this.runtimeCleanupFunctions.set(agentName, cleanup);
    }

    this.runtimes.set(agentName, runtime);

    // Register game event listeners on this runtime if we have observers
    if (this.gameEventObservers.length > 0) {
      this.registerGameEventListenersOnSingleRuntime(agentName, runtime);
    }

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

    const conversationMessage: ConversationMessageV3 = {
      authorId: fromRuntime.agentId,
      authorName: fromAgent,
      content,
      timestamp: deterministicTimestamp,
      channelId,
      metadata: options?.metadata,
    };

    // Add to local tracking immediately
    // channel.messages.push(conversationMessage);

    // Notify channel observers immediately
    // const observers = this.messageObservers.get(channelId);
    // if (observers) {
    //   observers.forEach((observer) => {
    //     try {
    //       observer(conversationMessage);
    //     } catch (error) {
    //       console.warn("Channel observer error:", error);
    //     }
    //   });
    // }

    // // NOW THE KEY PART: Emit MESSAGE_RECEIVED events directly to all participating agents
    // // This mimics what Discord plugin does and should trigger automatic responses
    // await this.emitMessageToParticipants(
    //   channelId,
    //   conversationMessage,
    //   fromAgent
    // );

    // internalMessageBus.emit("new_message", {
    //   id: serverMessage.id,
    //   channel_id: channelId,
    //   server_id: "00000000-0000-0000-0000-000000000000",
    //   author_id: fromRuntime.agentId,
    //   content: content,
    //   created_at: deterministicTimestamp,
    //   metadata: options?.metadata,
    // } as MessageServiceMessage);

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

    // 1. Create memory for the sender (since they won't get it via HTTP POST)
    const senderRuntime = this.runtimes.get(senderAgent);
    if (senderRuntime) {
      const roomId = createUniqueUuid(senderRuntime, channelId);
      const authorEntityId = createUniqueUuid(senderRuntime, message.authorId);

      const senderMemory: Memory = {
        entityId: authorEntityId,
        agentId: senderRuntime.agentId,
        roomId: roomId,
        content: {
          text: message.content,
          source: "test-simulator-v3",
          channelType: channel.type,
        },
        metadata: {
          entityName: message.authorName,
          fromId: message.authorId,
          type: "message",
          ...message.metadata,
        },
        createdAt: message.timestamp,
      };

      await senderRuntime.createMemory(senderMemory, "messages");
      console.log(
        `📝 Created memory for sender ${senderAgent}: "${message.content.substring(0, 50)}..."`
      );
    }

    // 2. HTTP POST to all participants (except sender)
    const baseUrl = `http://localhost:${this.config.serverPort}`;

    const payloadToServer = {
      channel_id: channelId,
      server_id: this.testServer!.id,
      author_id: message.authorId, // Use the original author's ID
      content: message.content,
      in_reply_to_message_id: undefined,
      source_type: "agent_response",
      raw_message: {
        text: message.content,
      },
      metadata: {
        agent_id: message.authorId,
        agentName: message.authorName,
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
      console.log(
        `📤 Posted message to ${senderAgent}: "${message.content.substring(0, 50)}..."`
      );
    } catch (error) {
      console.error(`Failed to post message to ${senderAgent}:`, error);
    }
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

    // Create entities for ALL participants on ALL runtimes FIRST
    const participantNames = config.room ? [...participants.keys()] : [];

    // Create entities for ALL participants on ALL runtimes
    for (const sourceParticipantName of participantNames) {
      const sourceRuntime = this.runtimes.get(sourceParticipantName);
      if (!sourceRuntime) continue;

      // Create this participant's entity on ALL OTHER runtimes
      for (const [
        targetParticipantName,
        targetRuntime,
      ] of this.runtimes.entries()) {
        if (sourceParticipantName === targetParticipantName) continue;

        const entityId = createUniqueUuid(targetRuntime, sourceRuntime.agentId);

        try {
          await targetRuntime.createEntity({
            id: entityId,
            names: [sourceParticipantName],
            agentId: targetRuntime.agentId, // The runtime that owns this entity record
            metadata: {
              source: "test-simulator-v3",
              originalAgentId: sourceRuntime.agentId, // Reference to actual agent
            },
          });
          console.log(
            `✅ Created entity for ${sourceParticipantName} on ${targetParticipantName}'s runtime with ID: ${entityId}`
          );
        } catch (error) {
          console.warn(
            `❌ Failed to create entity for ${sourceParticipantName} on ${targetParticipantName}'s runtime:`,
            error
          );
        }
      }
    }

    // Now create rooms for each participant
    for (const participantName of participantNames) {
      const runtime = this.runtimes.get(participantName);
      const roomId = createUniqueUuid(runtime, serverChannel.id);
      const worldId = createUniqueUuid(runtime, this.testServer!.id);
      await runtime.ensureWorldExists({
        id: worldId,
        name: "Game World",
        agentId: runtime.agentId,
        serverId: this.testServer!.id,
      });
      await runtime.ensureRoomExists({
        id: roomId,
        type: config.room.type,
        name: config.room.name,
        agentId: runtime.agentId,
        worldId: worldId,
        channelId: serverChannel.id,
        serverId: this.testServer!.id,
        source: "test-simulator-v3",
      });
      await runtime.addParticipant(runtime.agentId, roomId);
      for (const otherParticipantName of participantNames) {
        const otherRuntime = this.runtimes.get(otherParticipantName);
        if (otherRuntime) {
          // Use the SAME UUID generation as entity creation
          const participantEntityId = createUniqueUuid(
            runtime,
            otherRuntime.agentId
          );
          await runtime.ensureParticipantInRoom(participantEntityId, roomId);
        }
      }
      await runtime.setParticipantUserState(
        roomId,
        runtime.agentId,
        "FOLLOWED"
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

  // /**
  //  * Register a channel with a specific ID (for coordination testing)
  //  */
  // async registerChannel(
  //   channelId: UUID,
  //   config: ChannelConfigV3
  // ): Promise<void> {
  //   if (!this.testServer) {
  //     throw new Error(
  //       "Simulator not initialized. Please run initialize() first."
  //     );
  //   }

  //   // Create the room directly in the runtimes' databases
  //   const participants = new Map<string, ParticipantModeV3>();

  //   for (const participant of config.participants) {
  //     const agentName =
  //       typeof participant === "string" ? participant : participant.agentName;
  //     const mode =
  //       typeof participant === "string"
  //         ? ParticipantModeV3.READ_WRITE
  //         : participant.mode;
  //     participants.set(agentName, mode);

  //     // Create the room in each participant's runtime
  //     const runtime = this.runtimes.get(agentName);
  //     if (runtime) {
  //       await runtime.createRoom({
  //         id: channelId,
  //         worldId: createUniqueUuid(runtime, "test-world"),
  //         name: config.name,
  //         type: config.type || ChannelType.GROUP,
  //         metadata: config.metadata || {},
  //         source: "test-coordinator",
  //       });
  //     }
  //   }

  //   // Register channel in simulator tracking
  //   const channel: ChannelV3 = {
  //     id: channelId,
  //     name: config.name,
  //     type: config.type || ChannelType.GROUP,
  //     participants,
  //     messages: [],
  //     maxMessages: config.maxMessages,
  //     timeoutMs: config.timeoutMs,
  //     createdAt: Date.now(),
  //     isExhausted: false,
  //     observers: [],
  //   };

  //   this.channels.set(channelId, channel);
  //   this.messageObservers.set(channelId, []);

  //   console.log(`📡 Registered coordination channel: ${channelId}`);
  // }

  /**
   * Create a coordination channel with a predetermined ID
   */
  async createCoordinationChannel(participants: string[]): Promise<UUID> {
    const coordinationChannelId = await this.createChannel({
      name: "coordination-channel",
      participants,
      type: ChannelType.API,
      metadata: { purpose: "cross-agent-coordination" },
    });
    // Configure all agents to use the coordination channel and AgentServer
    for (const agentIds of participants) {
      const runtime = this.runtimes.get(agentIds);
      if (!runtime) {
        throw new Error(`Agent ${agentIds} not found`);
      }
      const coordinationService = runtime.getService<CoordinationService>(
        CoordinationService.serviceType
      );
      if (coordinationService) {
        if ("setCoordinationChannelId" in coordinationService) {
          coordinationService.setCoordinationChannelId(coordinationChannelId);
        } else {
          console.log(
            `🔧 Coordination service for ${agentIds} does not support setCoordinationChannelId`
          );
        }
        if ("setAgentServer" in coordinationService) {
          coordinationService.setAgentServer(this.server);
        } else {
          console.log(
            `🔧 Coordination service for ${agentIds} does not support setAgentServer`
          );
        }
        console.log(
          `🔧 Set coordination channel for ${agentIds}: ${coordinationChannelId}`
        );
      }
    }
    this.coordinationChannelId = coordinationChannelId;

    // Set up coordination message tracking via channel observer
    // this.observeChannel(coordinationChannelId, (message) => {
    //   this.trackCoordinationMessage(message);
    // });

    return coordinationChannelId;
  }

  /**
   * Track coordination messages for event analysis
   */
  trackCoordinationMessage(message: ConversationMessageV3): void {
    try {
      const parsed = JSON.parse(message.content);
      if (
        parsed.type &&
        ["game_event", "agent_ready", "heartbeat", "coordination_ack"].includes(
          parsed.type
        )
      ) {
        const event: CoordinationEvent = {
          messageId: parsed.messageId || message.id || "",
          timestamp: message.timestamp,
          sourceAgent: parsed.sourceAgent || message.authorId,
          targetAgents: parsed.targetAgents || "all",
          type: parsed.gameEventType || parsed.type,
          payload: parsed.payload || parsed,
        };
        message.coordinationEvent = event;

        this.coordinationEvents.push(event);

        // Update event counts
        const eventKey = `${parsed.type}:${parsed.gameEventType || parsed.type}`;
        this.eventCounts.set(
          eventKey,
          (this.eventCounts.get(eventKey) || 0) + 1
        );

        console.log(
          `📊 Tracked coordination event: ${eventKey} from ${message.authorName}`
        );
      }
    } catch (error) {
      // Not a coordination message, ignore
    }
  }

  /**
   * Wait for coordination events matching the provided condition
   */
  async waitForEvents(
    channelId: UUID,
    matcher: EventMatcher,
    timeoutMs: number = 10000
  ): Promise<ConversationMessageV3[]> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const events = this.getChannelMessages(channelId);
      if (matcher(events)) {
        return [...events];
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for events after ${timeoutMs}ms. Current events: ${this.getChannelMessages(channelId)?.length}`
    );
  }

  /**
   * Get coordination event counts for debugging
   */
  getEventCounts(): Map<string, number> {
    return new Map(this.eventCounts);
  }

  /**
   * Get all coordination events
   */
  getCoordinationEvents(): CoordinationEvent[] {
    return [...this.coordinationEvents];
  }

  /**
   * Clear coordination event tracking
   */
  clearCoordinationEvents(): void {
    this.coordinationEvents.length = 0;
    this.eventCounts.clear();
  }

  /**
   * Emit an event directly to a specific agent's runtime
   */
  async emitEventToAgent(
    agentName: string,
    eventType: string,
    payload: any
  ): Promise<void> {
    const runtime = this.runtimes.get(agentName);
    if (!runtime) {
      throw new Error(`Agent ${agentName} not found`);
    }

    await runtime.emitEvent(eventType, payload);
    console.log(`🚀 Emitted ${eventType} to ${agentName}`);
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

    // Clean up AgentServer message bus subscriptions
    for (const [subscriptionId, handler] of this.busSubscriptions.entries()) {
      internalMessageBus.off("new_message", handler);
      console.log(
        `🧹 Unsubscribed from AgentServer message bus: ${subscriptionId}`
      );
    }
    this.busSubscriptions.clear();

    // Clean up runtime event listeners
    for (const [
      agentName,
      unsubscribeFunctions,
    ] of this.runtimeEventListeners.entries()) {
      console.log(`🧹 Cleaning up event listeners for ${agentName}`);
      unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
    }
    this.runtimeEventListeners.clear();

    // Clean up game event observers
    this.gameEventObservers.splice(0, this.gameEventObservers.length);

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
