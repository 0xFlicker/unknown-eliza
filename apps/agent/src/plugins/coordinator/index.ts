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
  init: async (_config, runtime?: IAgentRuntime) => {
    if (runtime) {
      console.log("[CoordinatorPlugin] init for", runtime.character?.name);
      console.log(
        "[CoordinatorPlugin] services:",
        coordinatorPlugin.services?.length,
      );
      // // Explicitly register the service immediately so that it is available
      // // before the runtime finishes initializing (unit-tests emit game events
      // // almost immediately after creating agents).
      // await runtime.registerService(CoordinationService);

      logger.info(
        `🔗 Coordinator plugin registered + service started for ${runtime.character?.name}`,
      );
    } else {
      logger.info("🔗 Coordinator plugin registered");
    }
  },
};

// Re-export types and utilities for convenience
export * from "./types";
export * from "./service";
export * from "./roles";
