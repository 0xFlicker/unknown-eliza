import { internalMessageBus, MessageServiceStructure } from "@elizaos/server";
import { fromEvent } from "rxjs";
import { filter } from "rxjs/operators";
import { AnyCoordinationMessage, EmittableGameEventMessages } from "./types";

export default internalMessageBus;

// Type safe event listeners for coordination messages
export const gameAction$ = fromEvent(
  internalMessageBus,
  "game_action",
  (message) => {
    const event = message as AnyCoordinationMessage;
    // Only process coordination messages, silently ignore other event types
    if (event.type === "coordination_message" && "event" in event.payload) {
      const {
        payload: { event: action },
      } = event;
      return event;
    }
    // Return null for non-coordination messages, they'll be filtered out
    return null;
  },
).pipe(filter((event): event is AnyCoordinationMessage => event !== null));

export const gameEvent$ = fromEvent(
  internalMessageBus,
  "game_event",
  (message) => {
    const event = message as EmittableGameEventMessages;
    // Only process coordination messages, silently ignore other event types
    if (event.type === "coordination_message" && "emitted" in event.payload) {
      const {
        payload: { emitted: wrappedEvent },
      } = event;
      return event;
    }
    console.warn("Ignoring non-coordination game event message:", message.type);
    // Return null for non-coordination messages, they'll be filtered out
    return null;
  },
).pipe(filter((event): event is EmittableGameEventMessages => event !== null));

export const messages$ = fromEvent(
  internalMessageBus,
  "new_message",
  (message) => {
    const event = message as MessageServiceStructure;
    return event;
  },
);

// Capacity exceeded events (participant_limit or total_limit)
export const capacityExceeded$ = fromEvent(
  internalMessageBus,
  "channel_capacity_exceeded",
  (event) => event,
);
