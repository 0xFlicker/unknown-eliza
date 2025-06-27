import { vi } from "vitest";
import {
  stringToUuid,
  type IAgentRuntime,
  type Memory,
  type State,
  type Entity,
  type Room,
  type Metadata,
  type UUID,
} from "@elizaos/core";

export function createMockRuntime(
  overrides?: Partial<IAgentRuntime>,
): IAgentRuntime {
  const mockRoom: Room = {
    id: stringToUuid("test-room"),
    agentId: stringToUuid("test-agent"),
    source: "test",
    type: "SELF" as any, // Using any to avoid importing ChannelType enum
  };

  const mockEntity: Entity = {
    id: stringToUuid("test-entity"),
    agentId: stringToUuid("test-agent"),
    names: ["Test Entity"],
    metadata: {},
  };

  return {
    agentId: stringToUuid("test-agent"),
    // Memory operations
    getMemories: vi.fn().mockResolvedValue([]),
    saveMemory: vi.fn().mockResolvedValue(undefined),
    updateMemory: vi.fn().mockResolvedValue(undefined),

    // Entity operations
    getEntity: vi.fn().mockResolvedValue(mockEntity),
    getEntityById: vi.fn().mockResolvedValue(mockEntity),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(mockEntity),

    // Room operations
    getRoom: vi.fn().mockResolvedValue(mockRoom),
    getRooms: vi.fn().mockResolvedValue([mockRoom]),
    createRoom: vi.fn().mockResolvedValue(mockRoom),
    getEntitiesForRoom: vi.fn().mockResolvedValue([mockEntity]),

    // Relationship operations
    getRelationships: vi.fn().mockResolvedValue([]),
    saveRelationships: vi.fn().mockResolvedValue(undefined),
    updateRelationship: vi.fn().mockResolvedValue(undefined),
    getRelationshipsByEntityIds: vi.fn().mockResolvedValue([]),

    // Component operations
    getComponents: vi.fn().mockResolvedValue([]),
    createComponent: vi.fn().mockResolvedValue({
      id: stringToUuid("test-component"),
      type: "test",
      agentId: stringToUuid("test-agent"),
      entityId: stringToUuid("test-entity"),
      roomId: stringToUuid("test-room"),
      worldId: stringToUuid("test-world"),
      sourceEntityId: stringToUuid("test-agent"),
      data: {} as Metadata,
      createdAt: Date.now(),
    }),
    updateComponent: vi.fn().mockResolvedValue(undefined),
    deleteComponent: vi.fn().mockResolvedValue(undefined),

    // Task operations
    getTasks: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn().mockImplementation((task) => ({
      ...task,
      id: stringToUuid(`task-${Date.now()}`),
      createdAt: Date.now(),
    })),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),

    // Service operations
    getService: vi.fn(),

    // Model operations
    useModel: vi.fn().mockResolvedValue("test response"),

    // Settings
    getSetting: vi.fn(),

    // Event operations
    emitEvent: vi.fn().mockResolvedValue(undefined),

    // Other operations
    getParticipantUserState: vi.fn().mockResolvedValue(null),
    setParticipantUserState: vi.fn().mockResolvedValue(undefined),

    ...overrides,
  } as unknown as IAgentRuntime;
}

export function createMockMemory(overrides?: Partial<Memory>): Memory {
  return {
    id: stringToUuid("test-message"),
    entityId: stringToUuid("test-user"),
    content: {
      text: "Test message",
    },
    roomId: stringToUuid("test-room"),
    createdAt: Date.now(),
    ...overrides,
  };
}

export function createMockState(overrides?: Partial<State>): State {
  return {
    values: {},
    data: {},
    text: "Test message",
    agentId: stringToUuid("test-agent"),
    roomId: stringToUuid("test-room"),
    userId: stringToUuid("test-user"),
    messages: [],
    memories: [],
    goals: [],
    facts: [],
    knowledge: [],
    recentMessages: [],
    recentMessagesData: [],
    bio: "Test agent bio",
    senderName: "Test User",
    ...overrides,
  };
}

export function createMockEntity(name: string, id?: UUID): Entity {
  return {
    id: id || stringToUuid(`entity-${name}`),
    agentId: stringToUuid("test-agent"),
    names: [name],
    metadata: {},
  };
}
