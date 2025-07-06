import {
  Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventType,
  type UUID,
} from "@elizaos/core";
import { CoordinationService } from "./service";
import { messageReceivedHandler } from "./handlers";

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
  events: {
    [EventType.MESSAGE_RECEIVED]: [messageReceivedHandler],
  },
  services: [CoordinationService],
  init: async (config, runtime?: IAgentRuntime) => {
    if (runtime) {
      // Initialize the coordination service
      await CoordinationService.start(runtime);

      // Configure coordination channel ID if provided in config
      if (config?.coordinationChannelId) {
        const coordinationService = runtime.getService<CoordinationService>(
          CoordinationService.serviceType
        );
        if (coordinationService) {
          coordinationService.setCoordinationChannelId(
            config.coordinationChannelId as UUID
          );
        }
      }

      logger.info(
        `🔗 Coordinator plugin initialized for ${runtime.character?.name}`
      );
    } else {
      logger.info("🔗 Coordinator plugin initialized");
    }
  },
};

// Re-export types and utilities for convenience
export * from "./handlers";
export * from "./types";
export * from "./service";
export * from "./roles";
