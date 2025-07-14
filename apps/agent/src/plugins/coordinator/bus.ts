import { internalMessageBus } from "@elizaos/server";
import { fromEvent } from "rxjs";
import { AnyCoordinationMessage } from "./types";

export default internalMessageBus;

// Type safe event listeners for coordination messages
export const gameEvent$ = fromEvent(
  internalMessageBus,
  "game_event",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "game_event") {
      throw new Error(
        `Expected 'game_event' type, but received: ${event.type}`,
      );
    }
    return event;
  },
);

export const agentReady$ = fromEvent(
  internalMessageBus,
  "agent_ready",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "agent_ready") {
      throw new Error(
        `Expected 'agent_ready' type, but received: ${event.type}`,
      );
    }
    return event;
  },
);

export const heartbeat$ = fromEvent(
  internalMessageBus,
  "heartbeat",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "heartbeat") {
      throw new Error(`Expected 'heartbeat' type, but received: ${event.type}`);
    }
    return event;
  },
);

export const coordinationAck$ = fromEvent(
  internalMessageBus,
  "coordination_ack",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "coordination_ack") {
      throw new Error(
        `Expected 'coordination_ack' type, but received: ${event.type}`,
      );
    }
    return event;
  },
);
