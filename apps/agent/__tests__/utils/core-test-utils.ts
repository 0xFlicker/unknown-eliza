import { vi } from "vitest";
import {
  composeActionExamples,
  formatActionNames,
  formatActions,
  validateUuid,
} from "@elizaos/core";
import type {
  Action,
  Content,
  IAgentRuntime,
  Memory,
  State,
  Relationship,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import {
  AgentRuntime,
  asUUID,
  type IDatabaseAdapter,
  type UUID,
} from "@elizaos/core";

/**
 * Utility functions for reusing core package tests in project-starter tests
 */

/**
 * Runs core package action tests against the provided actions
 * @param actions The actions to test
 */
export const runCoreActionTests = (actions: Action[]) => {
  // Validate action structure (similar to core tests)
  for (const action of actions) {
    if (!action.name) {
      throw new Error("Action missing name property");
    }
    if (!action.description) {
      throw new Error(`Action ${action.name} missing description property`);
    }
    if (!action.examples || !Array.isArray(action.examples)) {
      throw new Error(`Action ${action.name} missing examples array`);
    }
    if (!action.similes || !Array.isArray(action.similes)) {
      throw new Error(`Action ${action.name} missing similes array`);
    }
    if (typeof action.handler !== "function") {
      throw new Error(`Action ${action.name} missing handler function`);
    }
    if (typeof action.validate !== "function") {
      throw new Error(`Action ${action.name} missing validate function`);
    }
  }

  // Validate example structure
  for (const action of actions) {
    for (const example of action.examples ?? []) {
      for (const message of example) {
        if (!message.name) {
          throw new Error(
            `Example message in action ${action.name} missing name property`
          );
        }
        if (!message.content) {
          throw new Error(
            `Example message in action ${action.name} missing content property`
          );
        }
        if (!message.content.text) {
          throw new Error(
            `Example message in action ${action.name} missing content.text property`
          );
        }
      }
    }
  }

  // Validate uniqueness of action names
  const names = actions.map((action) => action.name);
  const uniqueNames = new Set(names);
  if (names.length !== uniqueNames.size) {
    throw new Error("Duplicate action names found");
  }

  // Test action formatting
  const formattedNames = formatActionNames(actions);
  if (!formattedNames && actions.length > 0) {
    throw new Error("formatActionNames failed to produce output");
  }

  const formattedActions = formatActions(actions);
  if (!formattedActions && actions.length > 0) {
    throw new Error("formatActions failed to produce output");
  }

  const composedExamples = composeActionExamples(actions, 1);
  if (!composedExamples && actions.length > 0) {
    throw new Error("composeActionExamples failed to produce output");
  }

  return {
    formattedNames,
    formattedActions,
    composedExamples,
  };
};

/**
 * Creates a mock runtime for testing
 */
export const createMockRuntime = (): IAgentRuntime => {
  return {
    character: {
      name: "Test Character",
      system: "You are a helpful assistant for testing.",
    },
    getSetting: (key: string) => null,
    // Include real model functionality
    models: {},
    // Add real database functionality
    db: {
      get: async () => null,
      set: async () => true,
      delete: async () => true,
      getKeys: async () => [],
    },
    // Add real memory functionality
    memory: {
      add: async () => {},
      get: async () => null,
      getByEntityId: async () => [],
      getLatest: async () => null,
      getRecentMessages: async () => [],
      search: async () => [],
    },
    actions: [],
    providers: [],
    getService: vi.fn(),
    processActions: vi.fn(),
    useModel: vi
      .fn()
      .mockResolvedValue(JSON.stringify({ text: "Mock model response" })),
  } as any as IAgentRuntime;
};

/**
 * Documents test results for logging and debugging
 */
export const documentTestResult = (
  testName: string,
  result: any,
  error: Error | null = null
) => {
  // Clean, useful test documentation for developers
  logger.info(`✓ Testing: ${testName}`);

  if (error) {
    logger.error(`✗ Error: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
    return;
  }

  if (result) {
    if (typeof result === "string") {
      if (result.trim() && result.length > 0) {
        const preview =
          result.length > 60 ? `${result.substring(0, 60)}...` : result;
        logger.info(`  → ${preview}`);
      }
    } else if (typeof result === "object") {
      try {
        // Show key information in a clean format
        const keys = Object.keys(result);
        if (keys.length > 0) {
          const preview = keys.slice(0, 3).join(", ");
          const more = keys.length > 3 ? ` +${keys.length - 3} more` : "";
          logger.info(`  → {${preview}${more}}`);
        }
      } catch (e) {
        logger.info(`  → [Complex object]`);
      }
    }
  }
};

/**
 * Creates a mock message for testing
 */
export const createMockMessage = (text: string): Memory => {
  return {
    entityId: uuidv4(),
    roomId: uuidv4(),
    content: {
      text,
      source: "test",
    },
    metadata: {
      raw: {
        senderName: "test",
      },
      type: "mesage",
    },
  } as Memory;
};

/**
 * Creates a mock state for testing
 */
export const createMockState = (): State => {
  return {
    values: {},
    data: {},
    text: "",
  };
};

// --- Integration Test Utilities ---

// @ts-expect-error: test adapter does not implement full interface
export class InMemoryAdapter implements IDatabaseAdapter {
  db: any = {};
  private memories: Record<string, Memory> = {};
  private relationships: Record<string, Relationship> = {};
  private roomParticipants: Record<string, Set<UUID>> = {};
  agentId: UUID = asUUID(uuidv4());
  async init() {}
  async initialize() {}
  async runMigrations() {}
  async isReady() {
    return true;
  }
  async close() {}
  async getConnection() {
    return null;
  }
  async getAgent() {
    return null;
  }
  async getAgents() {
    return [];
  }
  async createAgent() {
    return true;
  }
  async updateAgent() {
    return true;
  }
  async deleteAgent() {
    return true;
  }
  async ensureEmbeddingDimension() {
    return;
  }
  async getEntityByIds() {
    return null;
  }
  async getEntitiesForRoom() {
    return [];
  }
  async createEntities() {
    return true;
  }
  async updateEntity(entity: any): Promise<void> {
    return;
  }
  async getComponent() {
    return null;
  }
  async getComponents() {
    return [];
  }
  async createComponent() {
    return true;
  }
  async updateComponent(component: any): Promise<void> {
    return;
  }
  async deleteComponent() {
    return;
  }
  async getMemories(params: {
    ids?: UUID[];
    tableName?: string;
    roomId?: UUID;
  }): Promise<Memory[]> {
    if (params.ids) {
      for (const id of params.ids) {
        if (!validateUuid(id)) {
          throw new Error("id is not a uuid");
        }
      }
      return params.ids.map((id) => this.memories[id]).filter(Boolean);
    }
    if (params.roomId) {
      return Object.values(this.memories).filter(
        (m) => m.roomId === params.roomId
      );
    }
    return Object.values(this.memories);
  }
  async getMemoryById(id: UUID): Promise<Memory | null> {
    return this.memories[id] || null;
  }
  async getMemoriesByIds(ids: UUID[], _tableName?: string): Promise<Memory[]> {
    return ids.map((id) => this.memories[id]).filter(Boolean);
  }
  async getMemoriesByRoomIds(params: {
    tableName: string;
    roomIds: UUID[];
    limit?: number;
  }): Promise<Memory[]> {
    return Object.values(this.memories).filter((m) =>
      params.roomIds.includes(m.roomId)
    );
  }
  async createMemory(
    memory: Memory,
    _tableName?: string,
    _unique?: boolean
  ): Promise<UUID> {
    if (!validateUuid(memory.id)) {
      throw new Error("memory.id is not a uuid");
    }
    this.memories[memory.id!] = memory;
    return memory.id!;
  }
  async updateMemory(memory: Partial<Memory> & { id: UUID }): Promise<boolean> {
    if (!validateUuid(memory.id)) {
      throw new Error("memory.id is not a uuid");
    }
    if (!this.memories[memory.id]) return false;
    this.memories[memory.id] = {
      ...this.memories[memory.id],
      ...memory,
    } as Memory;
    return true;
  }
  async deleteMemory(memoryId: UUID): Promise<void> {
    if (!validateUuid(memoryId)) {
      throw new Error("memoryId is not a uuid");
    }
    delete this.memories[memoryId];
  }
  async deleteManyMemories(memoryIds: UUID[]): Promise<void> {
    for (const id of memoryIds) delete this.memories[id];
  }
  async deleteAllMemories(roomId: UUID, _tableName: string): Promise<void> {
    Object.keys(this.memories).forEach((id) => {
      if (this.memories[id].roomId === roomId) delete this.memories[id];
    });
  }
  async countMemories(
    roomId: UUID,
    _unique?: boolean,
    _tableName?: string
  ): Promise<number> {
    return Object.values(this.memories).filter((m) => m.roomId === roomId)
      .length;
  }
  // No-op stubs for unused methods to satisfy the interface
  async getCachedEmbeddings() {
    return [];
  }
  async log() {
    return;
  }
  async getLogs() {
    return [];
  }
  async deleteLog() {
    return;
  }
  async getActorDetails() {
    return [];
  }
  async searchMemories() {
    return [];
  }
  async updateGoalStatus() {
    return;
  }
  async searchMemoriesByEmbedding() {
    return [];
  }
  async createWorld(world: any): Promise<UUID> {
    return asUUID(uuidv4());
  }
  async getWorld() {
    return null;
  }
  async removeWorld() {
    return;
  }
  async getAllWorlds() {
    return [];
  }
  async createRoom() {
    return null;
  }
  async getRoom() {
    return null;
  }
  async removeRoom(roomId: UUID): Promise<void> {
    return;
  }
  async getAllRooms() {
    return [];
  }
  async createTask(task: any): Promise<UUID> {
    return asUUID(uuidv4());
  }
  async getTask() {
    return null;
  }
  async removeTask() {
    return;
  }
  async getAllTasks() {
    return [];
  }
  async createParticipant() {
    return null;
  }
  async getParticipant() {
    return null;
  }
  async addParticipantsRoom(entityIds: UUID[], roomId: UUID): Promise<boolean> {
    if (!this.roomParticipants[roomId]) {
      this.roomParticipants[roomId] = new Set<UUID>();
    }
    entityIds.forEach((id) => this.roomParticipants[roomId].add(id));
    return true;
  }
  async removeParticipant(entityId: UUID, roomId: UUID): Promise<boolean> {
    const set = this.roomParticipants[roomId];
    if (set) {
      set.delete(entityId);
    }
    return true;
  }
  async getAllParticipants() {
    return [];
  }
  async createRelationship(params: {
    sourceEntityId: UUID;
    targetEntityId: UUID;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    // throw if sourceEntityId or targetEntityId is not a uuid
    if (!validateUuid(params.sourceEntityId)) {
      throw new Error("sourceEntityId is not a uuid");
    }
    if (!validateUuid(params.targetEntityId)) {
      throw new Error("targetEntityId is not a uuid");
    }
    const id = asUUID(uuidv4());
    this.relationships[id] = {
      id,
      sourceEntityId: params.sourceEntityId,
      targetEntityId: params.targetEntityId,
      agentId: this.agentId,
      tags: params.tags || [],
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
    };
    return true;
  }
  async getRelationship(params: {
    sourceEntityId: UUID;
    targetEntityId: UUID;
  }): Promise<Relationship | null> {
    if (!validateUuid(params.sourceEntityId)) {
      throw new Error("sourceEntityId is not a uuid");
    }
    if (!validateUuid(params.targetEntityId)) {
      throw new Error("targetEntityId is not a uuid");
    }
    const relationship = Object.values(this.relationships).find(
      (r) =>
        r.sourceEntityId === params.sourceEntityId &&
        r.targetEntityId === params.targetEntityId
    );
    return relationship || null;
  }
  async updateRelationship(relationship: Relationship): Promise<void> {
    if (!validateUuid(relationship.sourceEntityId)) {
      throw new Error("sourceEntityId is not a uuid");
    }
    if (!validateUuid(relationship.targetEntityId)) {
      throw new Error("targetEntityId is not a uuid");
    }
    if (relationship.id && this.relationships[relationship.id]) {
      this.relationships[relationship.id] = {
        ...this.relationships[relationship.id],
        ...relationship,
      };
    }
  }
  async getRelationships(params: {
    entityId: UUID;
    tags?: string[];
  }): Promise<Relationship[]> {
    if (!validateUuid(params.entityId)) {
      throw new Error("entityId is not a uuid");
    }
    return Object.values(this.relationships).filter((r) => {
      const matchesEntity =
        r.sourceEntityId === params.entityId ||
        r.targetEntityId === params.entityId;
      if (!params.tags || params.tags.length === 0) {
        return matchesEntity;
      }
      return matchesEntity && params.tags.some((tag) => r.tags.includes(tag));
    });
  }
  async createLog() {
    return null;
  }
  async getLog() {
    return null;
  }
  async removeLog() {
    return;
  }
  async getAllLogs() {
    return [];
  }
  async updateWorld(world: any): Promise<void> {
    return;
  }
  async getRoomsByIds() {
    return [];
  }
  async createRooms() {
    return [];
  }
  async deleteRoomsByWorldId() {
    return;
  }
  async getRoomsForParticipant() {
    return [];
  }
  async getRoomsForParticipants() {
    return [];
  }
  async getRoomsByWorld() {
    return [];
  }
  async updateRoom(room: any): Promise<void> {
    return;
  }
  async updateTask(id: UUID, task: any): Promise<void> {
    return;
  }
  async updateParticipant() {
    return null;
  }
  async updateAccount() {
    return null;
  }
  async updateGoal() {
    return null;
  }
  async updateMemories() {
    return [];
  }
  async updateWorlds() {
    return [];
  }
  async updateRooms() {
    return [];
  }
  async updateTasks() {
    return [];
  }
  async updateParticipants() {
    return [];
  }
  async updateRelationships() {
    return [];
  }
  async updateLogs() {
    return [];
  }
  async updateComponents() {
    return [];
  }
  async updateEntities() {
    return [];
  }
  async updateAgents() {
    return [];
  }
  async updateAccounts() {
    return [];
  }
  async updateGoals() {
    return [];
  }
  async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
    return Array.from(this.roomParticipants[roomId]?.values() ?? []);
  }
}

export function createTestRuntime(plugins: any[]): AgentRuntime {
  const runtime = new AgentRuntime({
    plugins,
    settings: { localMode: "true" },
  });
  // @ts-expect-error: test adapter does not implement full interface
  runtime.registerDatabaseAdapter(new InMemoryAdapter());
  return runtime;
}
