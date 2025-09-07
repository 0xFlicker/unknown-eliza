import { Plugin, type IAgentRuntime, elizaLogger } from "@elizaos/core";
import { CoordinationService } from "./service";

const logger = elizaLogger.child({ component: "CoordinatorPlugin" });

/**
 * The coordinator plugin handles cross-agent communication and event coordination.
 * This plugin should be included by all agents that need to participate in
 * cross-agent coordination (house, players, etc.).
 */
export const coordinatorPlugin: Plugin = {
  name: "coordinator",
  description: "Cross-agent coordination and messaging system",
  actions: [],
  providers: [],
  // No runtime message events – coordination happens exclusively via the
  // in-process `internalMessageBus`.
  services: [CoordinationService],
  init: async (_config, runtime?: IAgentRuntime) => {},
};

// Re-export types and utilities for convenience
export * from "./types";
export * from "./service";
export * from "./roles";
