import { EventEmitter } from "events";
import { UUID } from "@elizaos/core";
import type { Actor, SnapshotFrom } from "xstate";
import {
  createPhaseMachine as createHousePhaseMachine,
  PhaseEmitted as HousePhaseEmitted,
  PhaseEvent as HousePhaseEvent,
} from "@/plugins/house/game/phase";
import {
  createPlayerPhaseMachine as createPlayerPhaseMachine,
  PhaseEmitted as PlayerPhaseEmitted,
  PlayerPhaseEvent as PlayerPhaseEvent,
} from "@/plugins/influencer/game/phase";

/**
 * Test event bus that routes events between house and player state machines.
 * Mimics the open bus pattern where house can target one/some/all players,
 * and players can only send to house.
 */
export class TestEventBus {
  private houseActor: Actor<ReturnType<typeof createHousePhaseMachine>>;
  private playerActors: Map<
    UUID,
    Actor<ReturnType<typeof createPlayerPhaseMachine>>
  >;
  private eventEmitter: EventEmitter;
  private isStarted: boolean = false;

  constructor(
    houseActor: Actor<ReturnType<typeof createHousePhaseMachine>>,
    playerActors: Map<UUID, Actor<ReturnType<typeof createPlayerPhaseMachine>>>,
  ) {
    this.houseActor = houseActor;
    this.playerActors = playerActors;
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Start listening to house emitted events and route them to players
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Listen to house actor emitted events
    const houseListener = (event: HousePhaseEmitted) => {
      this.handleHouseEmitted(event);
    };
    this.houseActor.on("*", houseListener);

    // Listen to player actor emitted events and route to house
    for (const [playerId, playerActor] of this.playerActors.entries()) {
      const playerListener = (event: PlayerPhaseEmitted) => {
        this.handlePlayerEmitted(playerId, event);
      };
      playerActor.on("*", playerListener);
    }
  }

  /**
   * Stop all event listeners (no-op for now, listeners will be GC'd)
   */
  stop(): void {
    this.isStarted = false;
    // Note: XState actors don't support .off(), so we just mark as stopped
    // Listeners will be garbage collected when actors are destroyed
  }

  /**
   * Handle events emitted by the house machine
   */
  private handleHouseEmitted(event: HousePhaseEmitted): void {
    if (!event || typeof event !== "object") return;

    switch (event.type) {
      case "GAME:DIARY_PROMPT": {
        // Route to specific player based on targetPlayerId
        if (event.targetPlayerId) {
          const playerActor = this.playerActors.get(event.targetPlayerId);
          if (playerActor) {
            // Transform house event to player event format
            playerActor.send({
              type: "GAME:DIARY_PROMPT",
              roomId: event.roomId,
              messageId: event.messageId,
            });
          }
        }
        break;
      }

      case "GAME:ARE_YOU_READY": {
        // Route to all players (open bus pattern)
        // For ARE_YOU_READY, always broadcast to all players regardless of targetPlayerId
        for (const playerActor of this.playerActors.values()) {
          playerActor.send({
            type: "GAME:ARE_YOU_READY",
          });
        }
        break;
      }

      case "GAME:PHASE_ENTERED": {
        // Route to all players
        for (const playerActor of this.playerActors.values()) {
          playerActor.send({
            type: "GAME:PHASE_ENTERED",
            phase: event.phase,
            roomId: event.roomId,
          });
        }
        break;
      }

      case "GAME:INTRODUCTION_ROOM_CREATED": {
        // Route to all players so they know about the room
        for (const playerActor of this.playerActors.values()) {
          // Players might need to know about room creation
          // This is informational, no action needed unless player machine handles it
        }
        break;
      }

      // Other house events can be added here as needed
      default:
        // Ignore unknown events
        break;
    }
  }

  /**
   * Handle events emitted by player machines
   */
  private handlePlayerEmitted(playerId: UUID, event: PlayerPhaseEmitted): void {
    if (!event || typeof event !== "object") return;

    switch (event.type) {
      case "GAME:DIARY_RESPONSE": {
        // Route to house
        this.houseActor.send(event);
        break;
      }

      case "GAME:PLAYER_READY": {
        // Route to house
        this.houseActor.send(event);
        break;
      }

      // Other player events can be added here as needed
      default:
        // Ignore unknown events
        break;
    }
  }

  /**
   * Manually send an event to the house (for test setup)
   */
  sendToHouse(event: any): void {
    this.houseActor.send(event);
  }

  /**
   * Manually send an event to a specific player (for test setup)
   */
  sendToPlayer(playerId: UUID, event: any): void {
    const playerActor = this.playerActors.get(playerId);
    if (playerActor) {
      playerActor.send(event);
    }
  }

  /**
   * Manually send an event to all players (for test setup)
   */
  sendToAllPlayers(event: any): void {
    for (const playerActor of this.playerActors.values()) {
      playerActor.send(event);
    }
  }
}
