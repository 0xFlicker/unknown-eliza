import { Phase, PlayerStatus } from "../coordinator";

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
 * Game event for history tracking
 */
export interface GameEvent {
  id: string;
  type: string;
  playerId?: string;
  targetId?: string;
  phase: Phase;
  round: number;
  timestamp: number;
  details?: Record<string, any>;
}

/**
 * Phase-specific state tracking
 */
export interface PhaseState {
  // INTRODUCTION phase tracking
  introductionMessages?: Map<string, number>; // playerId -> message count
  introductionComplete?: Set<string>; // players who have introduced themselves
}

/**
 * Main game state
 */
export interface GameState {
  id: string;
  phase: Phase;
  round: number;
  players: Map<string, Player>; // playerId -> Player
  votes: Map<string, Vote>[]; // round -> playerId -> Vote
  privateRooms: Map<string, PrivateRoom>; // roomId -> PrivateRoom
  empoweredPlayer?: string; // current empowered player ID
  exposedPlayers: Set<string>; // currently exposed player IDs
  settings: GameSettings;
  timerEndsAt?: number; // when current phase timer expires
  history: GameEvent[];
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
