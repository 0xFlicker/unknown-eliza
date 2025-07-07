import {
  Character,
  IAgentRuntime,
  Plugin,
  UUID,
  ChannelType,
  type Memory,
  type Entity,
  type Relationship,
  RuntimeSettings,
} from "@elizaos/core";
import { Phase, GameSettings } from "../plugins/house/types";

/**
 * Participant state in a channel - controls message flow
 */
export enum ParticipantState {
  FOLLOWED = "FOLLOWED", // Can send and receive messages
  MUTED = "MUTED", // Cannot send messages, but can receive
}

/**
 * Participant mode in a channel - controls permissions
 */
export enum ParticipantMode {
  READ_WRITE = "read_write",
  BROADCAST_ONLY = "broadcast_only", // Can send but doesn't receive replies
  OBSERVE_ONLY = "observe_only", // Can only observe, cannot send
}

/**
 * Agent role assignment for game state setup
 */
export interface AgentRoleAssignment {
  /** Agent ID */
  agentId: UUID;
  /** Role in the game */
  role: "house" | "player" | "host";
}

/**
 * Configuration for a channel participant
 */
export interface ChannelParticipant {
  agentId: UUID;
  mode: ParticipantMode;
  state: ParticipantState;
}

/**
 * Channel configuration for creation
 */
export interface ChannelConfig {
  name: string;
  type: ChannelType;
  participants: ChannelParticipant[];
  metadata?: Record<string, unknown>;
  maxMessages?: number;
  timeoutMs?: number;
}

/**
 * Channel state and management
 */
export interface Channel {
  id: UUID;
  messageServerId: UUID; // Store the server ID for this channel
  name: string;
  type: ChannelType;
  participants: Map<UUID, ChannelParticipant>; // agentId -> participant config
  createdAt: number;
  maxMessages?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent configuration for creation
 */
export interface AgentConfig<Context extends Record<string, unknown>> {
  character: Character;
  plugins?: Plugin[];
  metadata?: Context;
}

/**
 * Agent state and management
 */
export interface Agent<Context extends Record<string, unknown>> {
  id: UUID;
  runtime: IAgentRuntime;
  character: Character;
  metadata?: Context;
  createdAt: number;
}

/**
 * Runtime decorator function for customizing agent behavior
 */
export type RuntimeDecorator<Runtime extends IAgentRuntime> = (
  runtime: Runtime
) => Runtime | Promise<Runtime>;

/**
 * Message observer function
 */
export type MessageObserver = (message: ChannelMessage) => void | Promise<void>;

/**
 * Channel message with metadata
 */
export interface ChannelMessage {
  id: UUID;
  channelId: UUID;
  authorId: UUID;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Coordination event for tracking cross-agent communication
 */
export interface CoordinationEvent {
  type: string;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others";
  timestamp: number;
  payload: Record<string, unknown>;
  messageId: string;
}

/**
 * Event matcher function for flexible event waiting
 */
export type EventMatcher = (events: ChannelMessage[]) => boolean;

/**
 * Game event observer function type
 */
export type GameEventObserver<T = Record<string, unknown>> = (
  eventType: string,
  payload: T
) => void | Promise<void>;

/**
 * Server configuration
 */
export interface AppServerConfig<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  dataDir?: string;
  serverPort?: number;
  runtimeConfig?: {
    runtime?: RuntimeDecorator<Runtime>;
    defaultPlugins?: Plugin[];
    runtimeSettings?: RuntimeSettings;
  };
  context: Context;
}

/**
 * Agent-channel association tracking for simplified channel management
 */
export interface AgentChannelAssociation {
  agentId: UUID;
  channelId: UUID;
  participant: ChannelParticipant;
  entityId: UUID; // Entity ID of this agent on the target runtime
}

export type AgentContext = {
  role: "house" | "player" | "host";
  entityName: string;
};
