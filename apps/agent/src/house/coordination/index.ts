/**
 * Cross-agent coordination system using existing AgentServer message bus
 *
 * This module provides a coordination layer that allows agents to communicate
 * game events and status updates across different agent runtimes without
 * requiring a separate socket infrastructure.
 *
 * Architecture:
 * 1. Uses a special coordination channel (COORDINATION_CHANNEL_ID)
 * 2. Messages are JSON-serialized coordination envelopes
 * 3. CoordinationAction processes incoming messages via MESSAGE_RECEIVED events
 * 4. CoordinationService sends outgoing messages via existing send handlers
 * 5. All routing happens through AgentServer's internal message bus
 */

export * from "./types";
export * from "./action";
export * from "./service";

export {
  COORDINATION_CHANNEL_ID,
  createGameEventMessage,
  createAgentReadyMessage,
  isCoordinationMessage,
  isGameEventCoordinationMessage,
  isAgentReadyCoordinationMessage,
} from "./types";

export {
  handleGameEvent,
  handleAgentReady,
  handleHeartbeat,
  handleCoordinationAck,
} from "./action";
export { CoordinationService } from "./service";
