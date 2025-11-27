import { UUID } from "@elizaos/core";
import type { PlayerPhaseSnapshot } from "../game/phase";
import type { PhaseInput } from "../game/types";

/**
 * Persisted state for an influencer agent. Unlike the house implementation we
 * only snapshot information that the player actually experienced.
 */
export interface PlayerGameState extends Record<string, unknown> {
  id: UUID;
  phaseInput: PhaseInput;
  phaseSnapshot: PlayerPhaseSnapshot;
}
