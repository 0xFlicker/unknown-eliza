import { internalMessageBus } from "@elizaos/server";
import { fromEvent } from "rxjs";
import { filter } from "rxjs/operators";
import { AnyCoordinationMessage } from "./types";

export default internalMessageBus;

// Type safe event listeners for coordination messages
export const gameEvent$ = fromEvent(
  internalMessageBus,
  "game_event",
  (message) => {
    const event = message as AnyCoordinationMessage;
    // Only process coordination messages, silently ignore other event types
    if (event.type === "coordination_message") {
      return event;
    }
    // Return null for non-coordination messages, they'll be filtered out
    return null;
  },
).pipe(filter((event): event is AnyCoordinationMessage => event !== null));
