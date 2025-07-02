import {
  IAgentRuntime,
  Service,
  elizaLogger,
  stringToUuid,
  type UUID,
  type Memory,
  type Entity,
} from "@elizaos/core";
import {
  StrategyState,
  StrategyMode,
  TrustLevel,
  StrategicRelationship,
  StrategyAnalysis,
  DiaryEntry,
  PlayerPattern,
  PlayerIntelligence,
  DEFAULT_STRATEGY_PROMPTS,
  StrategyPrompts,
} from "../types";
import { Phase } from "../../house/types";

const logger = elizaLogger;

export class StrategyService extends Service {
  static serviceType: string = "social-strategy";

  private state: StrategyState;
  private phaseCheckInterval?: NodeJS.Timeout;
  private strategyReviewInterval?: NodeJS.Timeout;

  constructor(runtime: IAgentRuntime, config?: Partial<StrategyPrompts>) {
    super(runtime);

    this.state = {
      agentId: runtime.agentId,
      currentPhase: Phase.INIT,
      round: 0,
      strategicMode: StrategyMode.OBSERVE,
      relationships: new Map(),
      analysis: this.createInitialAnalysis(),
      diaryEntries: [],
      playerPatterns: new Map(),
      lastPhaseChange: Date.now(),
      lastStrategyReview: Date.now(),
      configuration: { ...DEFAULT_STRATEGY_PROMPTS, ...config },
    };
  }

  capabilityDescription: string =
    "Manages strategic thinking, relationships, and game analysis for Influence game agents";

  static async stop(runtime: IAgentRuntime): Promise<unknown> {
    logger.info("*** Stopping StrategyService ***");
    const service = runtime.getService(
      StrategyService.serviceType,
    ) as StrategyService;
    if (!service) {
      throw new Error("StrategyService not found");
    }
    await service.stop();
    return void 0;
  }

  static async start(
    runtime: IAgentRuntime,
    config?: Partial<StrategyPrompts>,
  ): Promise<Service> {
    logger.info("*** Starting StrategyService ***");
    const service = new StrategyService(runtime, config);
    await service.initialize();
    return service;
  }

  async initialize(): Promise<void> {
    // Load existing state from memory if available
    await this.loadState();

    // Set up periodic checks for phase changes and strategy reviews
    this.setupPeriodicChecks();

    logger.info("StrategyService initialized", {
      agentId: this.state.agentId,
      currentPhase: this.state.currentPhase,
      strategicMode: this.state.strategicMode,
    });
  }

  async stop(): Promise<void> {
    logger.info("*** Stopping StrategyService ***");

    if (this.phaseCheckInterval) {
      clearInterval(this.phaseCheckInterval);
    }

    if (this.strategyReviewInterval) {
      clearInterval(this.strategyReviewInterval);
    }

    await this.saveState();
  }

  private createInitialAnalysis(): StrategyAnalysis {
    return {
      currentPhase: Phase.INIT,
      round: 0,
      alivePlayers: 0,
      powerPosition: "moderate",
      threats: [],
      allies: [],
      targets: [],
      protectionNeeded: false,
      confidenceLevel: 0.5,
      nextMoves: ["Observe other players", "Build initial impressions"],
      contingencies: {},
    };
  }

  private setupPeriodicChecks(): void {
    // Check for phase changes every 30 seconds
    this.phaseCheckInterval = setInterval(() => {
      this.checkPhaseChange();
    }, 30000);

    // Trigger strategy reviews every 5 minutes
    this.strategyReviewInterval = setInterval(() => {
      this.scheduleStrategyReview();
    }, 300000);
  }

  private async loadState(): Promise<void> {
    try {
      const stateMemory = await this.runtime.getCache<StrategyState>(
        `strategy-state-${this.state.agentId}`,
      );
      if (stateMemory) {
        // Restore state but keep constructor-provided configuration
        const config = this.state.configuration;
        this.state = {
          ...stateMemory,
          configuration: { ...stateMemory.configuration, ...config },
          relationships: new Map(
            Object.entries(stateMemory.relationships || {}) as [UUID, any][],
          ),
          playerPatterns: new Map(
            Object.entries(stateMemory.playerPatterns || {}) as [UUID, any][],
          ),
        };
        logger.info("Loaded existing strategy state from memory");
      }
    } catch (error) {
      logger.warn("Failed to load strategy state, using defaults", error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      const serializedState = {
        ...this.state,
        relationships: Object.fromEntries(this.state.relationships),
        playerPatterns: Object.fromEntries(this.state.playerPatterns),
      };
      await this.runtime.setCache(
        `strategy-state-${this.state.agentId}`,
        serializedState,
      );
      logger.debug("Strategy state saved to memory");
    } catch (error) {
      logger.error("Failed to save strategy state", error);
    }
  }


  private getStrategyModeForPhase(phase: Phase): StrategyMode {
    switch (phase) {
      case Phase.INIT:
      case Phase.LOBBY:
        return StrategyMode.OBSERVE;
      case Phase.WHISPER:
        return StrategyMode.CONSPIRE;
      case Phase.RUMOR:
        return StrategyMode.POSITION;
      case Phase.VOTE:
        return StrategyMode.DECIDE;
      case Phase.POWER:
        return StrategyMode.EXECUTE;
      case Phase.REVEAL:
        return StrategyMode.REFLECT;
      default:
        return StrategyMode.OBSERVE;
    }
  }

  async updateRelationship(
    playerId: UUID,
    playerName: string,
    updates: Partial<StrategicRelationship>,
  ): Promise<void> {
    const existing = this.state.relationships.get(playerId) || {
      playerId,
      playerName,
      trustLevel: TrustLevel.NEUTRAL,
      influence: 0.5,
      reliability: 0.5,
      threat: 0.5,
      lastInteraction: Date.now(),
      notes: [],
      alliances: [],
      weaknesses: [],
      strengths: [],
    };

    const updated: StrategicRelationship = {
      ...existing,
      ...updates,
      lastInteraction: Date.now(),
    };

    this.state.relationships.set(playerId, updated);
    await this.saveState();

    logger.debug("Updated strategic relationship", {
      playerId,
      playerName,
      updates,
    });
  }

  async addDiaryEntry(
    entry: Omit<DiaryEntry, "id" | "timestamp">,
  ): Promise<DiaryEntry> {
    const diaryEntry: DiaryEntry = {
      ...entry,
      id: stringToUuid(`diary-${this.state.agentId}-${Date.now()}`),
      timestamp: Date.now(),
    };

    this.state.diaryEntries.push(diaryEntry);

    // Keep only the last 50 entries to avoid memory bloat
    if (this.state.diaryEntries.length > 50) {
      this.state.diaryEntries = this.state.diaryEntries.slice(-50);
    }

    await this.saveState();

    logger.info("Added diary entry", {
      phase: diaryEntry.phase,
      round: diaryEntry.round,
      emotionalState: diaryEntry.emotionalState,
    });

    return diaryEntry;
  }

  async updatePlayerPattern(
    playerId: UUID,
    updates: Partial<PlayerPattern>,
  ): Promise<void> {
    const existing = this.state.playerPatterns.get(playerId) || {
      playerId,
      communicationStyle: "diplomatic",
      decisionMaking: "calculated",
      alliancePatterns: "loyal",
      informationSharing: "selective",
      riskTolerance: "medium",
      evidenceStrength: 0.1,
      observationCount: 0,
    };

    const updated: PlayerPattern = {
      ...existing,
      ...updates,
      observationCount: existing.observationCount + 1,
    };

    this.state.playerPatterns.set(playerId, updated);
    await this.saveState();

    logger.debug("Updated player pattern", { playerId, updates });
  }

  async generatePlayerIntelligence(
    playerId: UUID,
  ): Promise<PlayerIntelligence | null> {
    const relationship = this.state.relationships.get(playerId);
    const pattern = this.state.playerPatterns.get(playerId);

    if (!relationship) {
      logger.warn("No strategic relationship found for player", { playerId });
      return null;
    }

    // Get all messages involving this player
    const directObservations = await this.runtime.getMemories({
      tableName: "messages",
      entityId: playerId,
      count: 100,
    });

    // Get messages mentioning this player
    const thirdPartyReports = await this.runtime
      .getMemories({
        tableName: "messages",
        count: 200,
      })
      .then((memories) =>
        memories.filter(
          (m) =>
            m.content?.text
              ?.toLowerCase()
              .includes(relationship.playerName.toLowerCase()) &&
            m.entityId !== playerId,
        ),
      );

    const intelligence: PlayerIntelligence = {
      playerId,
      playerName: relationship.playerName,
      directObservations,
      thirdPartyReports,
      behavioralAnalysis: pattern || {
        playerId,
        communicationStyle: "diplomatic",
        decisionMaking: "calculated",
        alliancePatterns: "loyal",
        informationSharing: "selective",
        riskTolerance: "medium",
        evidenceStrength: 0.1,
        observationCount: 0,
      },
      strategicAssessment: relationship,
      trustworthiness: relationship.reliability,
      predictability: pattern?.evidenceStrength || 0.1,
      dangerLevel: relationship.threat,
      alliances: relationship.alliances,
      vulnerabilities: relationship.weaknesses,
      motivations: [], // Could be inferred from behavior
      recentActivity: directObservations
        .slice(0, 5)
        .map((m) => m.content?.text || ""),
    };

    return intelligence;
  }

  getState(): StrategyState {
    return { ...this.state };
  }

  getConfiguration(): StrategyPrompts {
    return { ...this.state.configuration };
  }

  async updateConfiguration(updates: Partial<StrategyPrompts>): Promise<void> {
    this.state.configuration = { ...this.state.configuration, ...updates };
    await this.saveState();
    logger.info("Strategy configuration updated");
  }

  private async checkPhaseChange(): Promise<void> {
    // This would be called by game events or polling
    // For now, it's a placeholder for phase detection logic
  }

  private async scheduleStrategyReview(): Promise<void> {
    const now = Date.now();
    const timeSinceLastReview = now - this.state.lastStrategyReview;

    // Only review if it's been at least 4 minutes since last review
    if (timeSinceLastReview > 240000) {
      this.state.lastStrategyReview = now;
      logger.info("Scheduling periodic strategy review");
      // This would trigger strategy evaluation
    }
  }

  private async triggerPhaseTransitionReview(
    previousPhase: Phase,
    newPhase: Phase,
  ): Promise<void> {
    logger.info("Triggering phase transition review", {
      previousPhase,
      newPhase,
    });
    // This would trigger strategy re-evaluation based on the new phase
  }

  /**
   * Update strategic context based on events or phase transitions
   */
  async updateStrategicContext(context: {
    phase: Phase;
    trigger: 'phase_transition' | 'event' | 'manual';
    contextData?: Record<string, unknown>;
  }): Promise<void> {
    logger.info("Updating strategic context", {
      phase: context.phase,
      trigger: context.trigger
    });

    // Update phase if different
    if (this.state.currentPhase !== context.phase) {
      await this.updatePhase(context.phase, this.state.round);
    }

    // Update strategic mode based on new context
    const newMode = this.getStrategyModeForPhase(context.phase);
    if (this.state.strategicMode !== newMode) {
      this.state.strategicMode = newMode;
      logger.debug("Strategic mode updated", { oldMode: this.state.strategicMode, newMode });
    }

    // Store context data if provided
    if (context.contextData) {
      // This could be stored in analysis or a separate context field
      this.state.analysis.contextData = context.contextData;
    }

    await this.saveState();
  }

  /**
   * Set diary prompt for phase-dependent prompting
   */
  async setDiaryPrompt(prompt: string): Promise<void> {
    logger.debug("Setting phase-dependent diary prompt", { 
      phase: this.state.currentPhase,
      promptLength: prompt.length 
    });

    // Store the prompt in configuration for use by diary room action
    this.state.configuration.diaryReflection = prompt;
    await this.saveState();
  }

  /**
   * Update the current phase and round
   */
  async updatePhase(phase: Phase, round: number): Promise<void> {
    const previousPhase = this.state.currentPhase;
    
    this.state.currentPhase = phase;
    this.state.round = round;
    this.state.lastPhaseChange = Date.now();
    this.state.strategicMode = this.getStrategyModeForPhase(phase);

    logger.info("Phase updated", {
      previousPhase,
      newPhase: phase,
      round,
      strategicMode: this.state.strategicMode
    });

    await this.saveState();

    // Trigger phase transition review
    await this.triggerPhaseTransitionReview(previousPhase, phase);
  }

  /**
   * Analyze phase completion for strategic insights
   */
  async analyzePhaseCompletion(phase: Phase, round: number): Promise<void> {
    logger.info("Analyzing phase completion", { phase, round });

    // Create a diary entry for phase completion analysis
    const phaseAnalysisEntry = {
      phase,
      round,
      thoughts: `Completed ${phase} phase - analyzing strategic outcomes and preparing for next phase.`,
      emotionalState: "confident" as const,
      observations: [
        `Phase ${phase} completed successfully`,
        "Gathering strategic intelligence for next phase"
      ],
      concerns: [],
      opportunities: ["Prepare strategy for upcoming phase transitions"]
    };

    await this.addDiaryEntry(phaseAnalysisEntry);
    
    // Update last strategy review time
    this.state.lastStrategyReview = Date.now();
    await this.saveState();
  }

  // Legacy compatibility method
  async getOrCreatePlayer({ handle }: { handle: string }): Promise<Entity> {
    logger.info("*** Adding player to memories (legacy compatibility) ***");
    const id = stringToUuid(
      `${this.runtime.agentId}:player:${handle.toLowerCase()}`,
    );

    const entity = await this.runtime.getEntityById(id);
    if (entity) {
      return entity;
    }

    const now = Date.now();
    const newPlayer: Entity = {
      id,
      agentId: this.runtime.agentId,
      names: [handle],
      metadata: {
        trustScore: 50,
        firstInteraction: now,
        lastInteraction: now,
        relationshipType: "neutral",
        interactionCount: 1,
      },
    };

    await this.runtime.createEntity(newPlayer);

    // Also add to strategic relationships
    await this.updateRelationship(id, handle, {
      playerId: id,
      playerName: handle,
      trustLevel: TrustLevel.NEUTRAL,
    });

    return newPlayer;
  }
}

// Export legacy class for compatibility
export const AddPlayerService = StrategyService;
