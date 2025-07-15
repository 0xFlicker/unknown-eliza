import {
  type UUID,
  type Memory,
  type Entity,
  type Relationship,
  type State,
} from "@elizaos/core";
import { Phase } from "../coordinator";

/**
 * Strategy modes for different game phases
 */
export enum StrategyMode {
  OBSERVE = "observe", // INIT, LOBBY - watch and learn
  CONSPIRE = "conspire", // WHISPER - build alliances
  POSITION = "position", // RUMOR - shape public opinion
  DECIDE = "decide", // VOTE - make tactical choices
  EXECUTE = "execute", // POWER - act on strategic plans
  REFLECT = "reflect", // REVEAL - analyze outcomes
}

/**
 * Trust levels for other players
 */
export enum TrustLevel {
  ALLY = "ally", // Trusted partner
  NEUTRAL = "neutral", // Unknown or uncommitted
  THREAT = "threat", // Perceived danger
  ENEMY = "enemy", // Active opposition
}

/**
 * Strategic relationship assessment
 */
export interface StrategicRelationship {
  playerId: UUID;
  playerName: string;
  trustLevel: TrustLevel;
  influence: number; // 0-1 scale of their perceived influence
  reliability: number; // 0-1 scale of their trustworthiness
  threat: number; // 0-1 scale of danger they pose
  lastInteraction: number;
  notes: string[];
  alliances: UUID[]; // Other players they seem allied with
  weaknesses: string[]; // Observed strategic weaknesses
  strengths: string[]; // Observed strategic strengths
}

/**
 * Strategic analysis of game state
 */
export interface StrategyAnalysis {
  currentPhase: Phase;
  round: number;
  alivePlayers: number;
  powerPosition: "strong" | "moderate" | "weak";
  threats: UUID[]; // Players perceived as threats
  allies: UUID[]; // Trusted allies
  targets: UUID[]; // Potential elimination targets
  protectionNeeded: boolean;
  confidenceLevel: number; // 0-1 scale
  nextMoves: string[]; // Planned actions
  contingencies: Record<string, string>; // Backup plans
  contextData?: Record<string, unknown>; // Additional context from events
}

/**
 * Diary room entry for reflection
 */
export interface DiaryEntry {
  id: UUID;
  round: number;
  phase: Phase;
  timestamp: number;
  thoughts: string;
  observations: string[];
  strategyShift?: string;
  emotionalState:
    | "confident"
    | "nervous"
    | "suspicious"
    | "optimistic"
    | "defeated";
  concerns: string[];
  opportunities: string[];
}

/**
 * Player behavioral pattern recognition
 */
export interface PlayerPattern {
  playerId: UUID;
  communicationStyle: "aggressive" | "diplomatic" | "passive" | "manipulative";
  decisionMaking: "impulsive" | "calculated" | "cautious" | "erratic";
  alliancePatterns: "loyal" | "opportunistic" | "betrayer" | "loner";
  informationSharing: "open" | "selective" | "secretive" | "deceptive";
  riskTolerance: "high" | "medium" | "low";
  evidenceStrength: number; // Confidence in pattern assessment
  observationCount: number;
}

/**
 * Configurable strategy prompts
 */
export interface StrategyPrompts {
  diaryReflection: string;
  playerAnalysis: string;
  phaseTransition: string;
  relationshipAssessment: string;
  threatEvaluation: string;
  allianceFormation: string;
  endgameStrategy: string;
}

/**
 * Strategy service state
 */
export interface StrategyState {
  gameId?: string;
  agentId: UUID;
  currentPhase: Phase;
  round: number;
  strategicMode: StrategyMode;
  relationships: Map<UUID, StrategicRelationship>;
  analysis: StrategyAnalysis;
  diaryEntries: DiaryEntry[];
  playerPatterns: Map<UUID, PlayerPattern>;
  lastPhaseChange: number;
  lastStrategyReview: number;
  configuration: StrategyPrompts;
}

/**
 * Intelligence report on a specific player
 */
export interface PlayerIntelligence {
  playerId: UUID;
  playerName: string;
  directObservations: Memory[]; // Messages from/to this player
  thirdPartyReports: Memory[]; // What others said about them
  behavioralAnalysis: PlayerPattern;
  strategicAssessment: StrategicRelationship;
  trustworthiness: number; // 0-1 scale
  predictability: number; // 0-1 scale
  dangerLevel: number; // 0-1 scale
  alliances: UUID[];
  vulnerabilities: string[];
  motivations: string[];
  recentActivity: string[];
}

/**
 * Default strategy prompts
 */
export const DEFAULT_STRATEGY_PROMPTS: StrategyPrompts = {
  diaryReflection: `
You are reflecting on the current game state and your strategic position. Consider:
- What has happened since your last reflection
- How your relationships have evolved
- What threats and opportunities you see
- Your emotional state and confidence level
- What your next moves should be

Be honest and strategic in your private thoughts.`,

  playerAnalysis: `
Analyze this player based on all available information:
- Their communication patterns and behavior
- Their apparent alliances and relationships
- Their strategic choices and reasoning
- Their strengths and weaknesses
- How much you trust them and why
- The threat level they represent

Provide a comprehensive intelligence assessment.`,

  phaseTransition: `
The game phase is changing. Review your strategy:
- How does this phase change affect your position?
- What new opportunities or threats emerge?
- Should you adjust your alliances or targets?
- What actions should you prioritize?
- How confident are you in your current strategy?

Adapt your approach for the new phase.`,

  relationshipAssessment: `
Evaluate your relationship with other players:
- Who can you trust and who is a threat?
- Which alliances are strong vs. fragile?
- Who has influence and who is isolated?
- What information have you gained about each player?
- How should you adjust your social strategy?

Update your player assessments and trust levels.`,

  threatEvaluation: `
Assess current threats and dangers:
- Which players pose the biggest threat to your survival?
- Who is gaining too much influence or power?
- What alliances are forming against you?
- Are you in immediate danger this round?
- How can you neutralize or redirect threats?

Develop threat mitigation strategies.`,

  allianceFormation: `
Consider your alliance strategy:
- Who would be valuable allies?
- What can you offer potential partners?
- Which existing alliances should you join or break?
- How can you position yourself as indispensable?
- What information should you share or withhold?

Plan your social maneuvering carefully.`,

  endgameStrategy: `
Plan for the final stages of the game:
- Who are your biggest competitors for victory?
- What moves will secure your win?
- When should you betray current allies?
- How can you manipulate final eliminations?
- What's your backup plan if your strategy fails?

Prepare for the endgame with ruthless calculation.`,
};
