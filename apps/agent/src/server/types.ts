import { Character, IAgentRuntime, Plugin, UUID } from "@elizaos/core";
import dotenv from "dotenv";
import { Phase, GameSettings } from "../plugins/house/types";

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
export type EventMatcher = (events: ConversationMessage[]) => boolean;

const testEnv = dotenv.config({
  path: ".env.test",
});

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
  providers?: string[]; // Providers that generated this message
  actions?: string[]; // Actions taken by the agent
  thought?: string; // Optional thoughts for debugging
  metadata?: any;
  coordinationEvent?: CoordinationEvent;
}

/**
 * Participant mode in a channel
 */
export enum ParticipantMode {
  READ_WRITE = "read_write",
  BROADCAST_ONLY = "broadcast_only", // Can send but doesn't receive replies
  OBSERVE_ONLY = "observe_only", // Can only observe, cannot send
}

export type AgentRole = "house" | "player" | "host";

export interface AgentAssignment {
  character: Character;
  plugins: Plugin[];
  roles: AgentRole[];
}

export type RuntimeDecorator<Runtime extends IAgentRuntime> = (
  runtime: Partial<Runtime>
) => Runtime | Partial<Runtime>;

export interface AppServerConfig<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  dataDir?: string;
  serverPort?: number;
  runtimeConfig?: {
    runtime?: RuntimeDecorator<Runtime>;
    defaultPlugins?: Plugin[];
  };
  context: Context;
}
