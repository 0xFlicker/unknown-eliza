import { EventEmitter } from "events";
import { fromEvent } from "rxjs";
import { AnyCoordinationMessage } from "./types";

/**
 * A simple in-memory message bus for distributing messages from the server
 * to subscribed MessageBusService instances within the same process.
 *
 * For multi-process or multi-server deployments, this would need to be replaced
 * with a more robust solution like Redis Pub/Sub, Kafka, RabbitMQ, etc.
 */
class InternalMessageBus extends EventEmitter {}

const internalMessageBus = new InternalMessageBus();

// Increase the default max listeners if many agents might be running in one process
internalMessageBus.setMaxListeners(50);

export default internalMessageBus;

// Type safe event listeners for coordination messages
export const gameEvent$ = fromEvent(
  internalMessageBus,
  "game_event",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "game_event") {
      throw new Error(
        `Expected 'game_event' type, but received: ${event.type}`
      );
    }
    return event;
  }
);

export const agentReady$ = fromEvent(
  internalMessageBus,
  "agent_ready",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "agent_ready") {
      throw new Error(
        `Expected 'agent_ready' type, but received: ${event.type}`
      );
    }
    return event;
  }
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
  }
);

export const coordinationAck$ = fromEvent(
  internalMessageBus,
  "coordination_ack",
  (message) => {
    const event = message as AnyCoordinationMessage;
    if (event.type !== "coordination_ack") {
      throw new Error(
        `Expected 'coordination_ack' type, but received: ${event.type}`
      );
    }
    return event;
  }
);
