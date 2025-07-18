import { UUID } from "@elizaos/core";

/**
 * Game settings and configuration
 */
export interface GameSettings {
  maxPlayers: number;
  minPlayers: number;
  timers: {
    lobby: number; // in milliseconds
    whisper: number; // in milliseconds
    rumor: number;
    vote: number;
    power: number;
    reveal: number;
  };
  maxDMRecipients: number;
}

/**
 * Individual player in the game
 */
export interface Player {
  id: string;
  agentId: string;
  name: string;
  status: PlayerStatus;
  empoweredRound?: number; // Round when this player was empowered
  joinedAt: number;
}

/**
 * Vote cast by a player in the VOTE phase
 */
export interface Vote {
  round: number;
  voter: string; // player ID
  empowerTarget?: string; // player ID to empower
  exposeTarget?: string; // player ID to expose
  timestamp: number;
}

/**
 * Private room for WHISPER phase
 */
export interface PrivateRoom {
  id: string;
  participants: string[]; // player IDs
  createdBy: string; // player ID who requested
  createdAt: number;
  active: boolean;
}

/**
 * Phase-specific state tracking
 */
export interface PhaseState {
  // INTRODUCTION phase tracking
  introductionMessages?: Record<UUID, number>; // playerId -> message count
  introductionComplete?: UUID[]; // players who have introduced themselves
}

/**
 * Main game state
 */
export interface GameState {
  id: UUID;
  phase: Phase;
  round: number;
  players: Record<UUID, Player>; // playerId -> Player
  votes: Record<number, Record<UUID, Vote>>[]; // round -> playerId -> Vote
  privateRooms: Record<UUID, PrivateRoom>; // roomId -> PrivateRoom
  empoweredPlayer?: string; // current empowered player ID
  exposedPlayers: string[]; // currently exposed player IDs
  settings: GameSettings;
  timerEndsAt?: number; // when current phase timer expires
  // DEPRECATED: use gameEvents instead
  history: any[];
  isActive: boolean;
  hostId?: string;
  phaseState: PhaseState; // Phase-specific state tracking
}

/**
 * Default game settings
 */
export const DEFAULT_GAME_SETTINGS: GameSettings = {
  maxPlayers: 12,
  minPlayers: 4,
  timers: {
    lobby: 5 * 60 * 1000, // 5 minutes
    whisper: 10 * 60 * 1000, // 10 minutes
    rumor: 5 * 60 * 1000, // 5 minutes
    vote: 3 * 60 * 1000, // 3 minutes
    power: 2 * 60 * 1000, // 2 minutes
    reveal: 30 * 1000, // 30 seconds
  },
  maxDMRecipients: 4,
};

// Event union
export type AllGameEvents =
  | { type: "PLAYER_JOINED"; player: Player }
  | { type: "PLAYER_LEFT"; playerId: UUID }
  | { type: "ARE_YOU_READY" }
  | { type: "I_AM_READY"; playerId: UUID }
  | { type: "ALL_PLAYERS_READY" }
  | { type: "PLAYER_INTRODUCED"; playerId: UUID }
  | { type: "LOBBY_MESSAGE_SENT"; playerId: UUID; content: string };

/**
 * Influence game phases
 */

export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  INTRODUCTION_DIARY_ROOM = "INTRODUCTION_DIARY_ROOM",
  LOBBY = "LOBBY",
  LOBBY_DIARY_ROOM = "LOBBY_DIARY_ROOM",
  WHISPER = "WHISPER",
  WHISPER_DIARY_ROOM = "WHISPER_DIARY_ROOM",
  RUMOR = "RUMOR",
  RUMOR_DIARY_ROOM = "RUMOR_DIARY_ROOM",
  VOTE = "VOTE",
  VOTE_DIARY_ROOM = "VOTE_DIARY_ROOM",
  POWER = "POWER",
  POWER_DIARY_ROOM = "POWER_DIARY_ROOM",
  REVEAL = "REVEAL",
  REVEAL_DIARY_ROOM = "REVEAL_DIARY_ROOM",
}

/**
 * Player status in the game
 */
export enum PlayerStatus {
  ALIVE = "alive",
  ELIMINATED = "eliminated",
  EXPOSED = "exposed", // Can be targeted for elimination or protection
}
