import {
  type IAgentRuntime,
  type Memory,
  type Entity,
  type Room,
  type UUID,
  stringToUuid,
  logger,
  ChannelType,
  State,
} from "@elizaos/core";

export interface UserProfile {
  name: string;
  roles?: string[];
  metadata?: Record<string, any>;
}

export interface ConversationStep {
  from: string; // User name
  content: string;
  actions?: string[];
  delay?: number; // Milliseconds to wait before sending
}

export interface ConversationScript {
  name: string;
  description: string;
  room: {
    name: string;
    type: ChannelType;
  };
  participants: UserProfile[];
  steps: ConversationStep[];
}

export interface SimulatedUser {
  entity: Entity;
  profile: UserProfile;
}

export class ConversationSimulator {
  private runtime: IAgentRuntime;
  public users: Map<string, SimulatedUser> = new Map();
  public rooms: Map<string, Room> = new Map();
  private world: UUID;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.world = stringToUuid("test-world-" + runtime.agentId);
  }

  /**
   * Creates a test user entity
   */
  async createUser(profile: UserProfile): Promise<Entity> {
    const userId = stringToUuid(`user-${profile.name}-${Date.now()}`);

    const entity: Entity = {
      id: userId,
      agentId: this.runtime.agentId,
      names: [profile.name],
      metadata: {
        ...profile.metadata,
        isTestUser: true,
        createdBy: "ConversationSimulator",
      },
    };

    await this.runtime.createEntity(entity);

    this.users.set(profile.name, {
      entity,
      profile,
    });

    logger.debug("[ConversationSimulator] Created test user", {
      name: profile.name,
      entityId: entity.id,
    });

    return entity;
  }

  /**
   * Creates or gets a test room
   */
  async getOrCreateRoom(roomConfig: {
    name: string;
    type: ChannelType;
  }): Promise<Room> {
    const existing = this.rooms.get(roomConfig.name);
    if (existing) return existing;

    const roomId = stringToUuid(`room-${roomConfig.name}-${Date.now()}`);

    const room: Room = {
      id: roomId,
      agentId: this.runtime.agentId,
      name: roomConfig.name,
      source: "test",
      type: roomConfig.type,
      worldId: this.world,
      metadata: {
        isTestRoom: true,
        createdBy: "ConversationSimulator",
      },
    };

    await this.runtime.createRoom(room);
    this.rooms.set(roomConfig.name, room);

    logger.debug("[ConversationSimulator] Created test room", {
      name: roomConfig.name,
      roomId: room.id,
    });

    return room;
  }

  /**
   * Simulates sending a message from a user
   */
  async sendMessage({
    from,
    content,
    room,
    actions,
  }: {
    from: Entity;
    content: string;
    room: Room;
    actions?: string[];
  }): Promise<Memory> {
    const messageId = stringToUuid(`msg-${from.id}-${Date.now()}`);

    const memory: Memory = {
      id: messageId,
      agentId: this.runtime.agentId,
      entityId: from.id as UUID,
      roomId: room.id,
      content: {
        text: content,
        type: "text",
        actions,
      },
      createdAt: Date.now(),
    } as Memory;

    await this.runtime.createMemory(memory, "messages");

    logger.debug("[ConversationSimulator] Message sent", {
      from: from.names[0],
      roomId: room.id,
      preview: content.slice(0, 40),
    });

    return memory;
  }

  /**
   * Executes a multi-turn conversation script.
   * Optionally invokes a callback after every message so tests can
   * hook custom logic (e.g. call action handlers).
   */
  async runConversation(
    script: ConversationScript,
    onMessage?: (memory: Memory, state: State) => Promise<void> | void
  ): Promise<void> {
    const room = await this.getOrCreateRoom(script.room);
    // Create participants
    for (const participant of script.participants) {
      const { id } = await this.createUser(participant);
      await this.runtime.ensureParticipantInRoom(id as UUID, room.id);
    }

    for (const step of script.steps) {
      const user = this.users.get(step.from);
      if (!user) throw new Error(`User ${step.from} not found`);

      if (step.delay) await new Promise((r) => setTimeout(r, step.delay));

      const memory = await this.sendMessage({
        from: user.entity,
        content: step.content,
        room,
        actions: step.actions,
      });

      // Let runtime evaluators run (if any)
      const state = await this.runtime.composeState(memory);
      const result = await this.runtime.evaluate(memory, state, true);

      if (onMessage) await onMessage(memory, state);

      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Waits for evaluators */
  async waitForEvaluators(timeout = 500): Promise<void> {
    await new Promise((r) => setTimeout(r, timeout));
  }

  getUser(name: string): SimulatedUser | undefined {
    return this.users.get(name);
  }
}
