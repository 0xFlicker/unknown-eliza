// apps/agent/src/memory/selectors.ts
import { GameState } from "./types";
import { Phase } from "./types";
import { UUID } from "@elizaos/core";

/**
 * Get the current phase from the context.
 * Note: In XState, the phase is stored in context.phase, but could be derived from machine.value if needed.
 */
export const getCurrentPhase = (ctx: GameState): Phase => ctx.phase;

/**
 * Check if all players are ready in INIT phase and minimum player requirement is met.
 * This mirrors the guard for INIT → INTRODUCTION transition.
 */
export const isAllReady = (ctx: GameState): boolean =>
  ctx.phase === Phase.INIT &&
  // TODO: FIXME: the GameState does not have a great way to track that because it was only built for the INTRODUCTION phase
  // getReadyCount(ctx) === getPlayerCount(ctx) &&
  getPlayerCount(ctx) >= ctx.settings.minPlayers;

/**
 * Get the number of players who have completed their introduction in INTRODUCTION phase.
 */
export const getIntroducedCount = (ctx: GameState): number =>
  ctx.phaseState.introductionComplete?.length ?? 0;

/**
 * Check if all players have introduced themselves in INTRODUCTION phase.
 * This mirrors the guard for INTRODUCTION → LOBBY transition.
 */
export const isIntroComplete = (ctx: GameState): boolean =>
  ctx.phase === Phase.INTRODUCTION &&
  getIntroducedCount(ctx) === getPlayerCount(ctx);

/**
 * Calculate the remaining time in milliseconds for the current phase timer.
 * Returns 0 if no timer is set or expired.
 */
export const getTimerRemaining = (ctx: GameState): number =>
  ctx.timerEndsAt ? Math.max(0, ctx.timerEndsAt - Date.now()) : 0;

/**
 * Get the total number of active players in the game.
 */
export const getPlayerCount = (ctx: GameState): number =>
  Object.keys(ctx.players).length;

/**
 * Get the number of messages sent by a specific player in INTRODUCTION phase.
 * Useful for optional coordinated transitions (e.g., if all have messaged).
 */
export const getIntroductionMessageCount = (
  ctx: GameState,
  playerId: UUID,
): number =>
  ctx.phase === Phase.INTRODUCTION
    ? (ctx.phaseState.introductionMessages?.[playerId] ?? 0)
    : 0;
