import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  ModelType,
  composePrompt,
  type UUID,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { Phase } from "../../house/types";
import { GameEventType } from "../../house/events/types";
import { CoordinationService } from "../../house/coordination";

const logger = elizaLogger.child({ component: "PhaseTransitionThinking" });

/**
 * Strategic analysis output for phase transitions
 */
interface PhaseTransitionAnalysis {
  phaseAssessment: {
    fromPhase: string;
    toPhase: string;
    readiness: number; // 0-1 scale
    confidence: number; // 0-1 scale
  };
  conversationAnalysis: {
    keyInteractions: string[];
    playerBehaviors: Array<{
      playerName: string;
      behavior: string;
      trustChange: number; // -1 to +1
      threatLevel: number; // 0-1
    }>;
    emergingAlliances: string[];
    detectedThreats: string[];
  };
  strategicShifts: {
    newPriorities: string[];
    tacticChanges: string[];
    relationshipUpdates: Array<{
      playerName: string;
      newAssessment: string;
      actionPlan: string;
    }>;
  };
  nextPhasePreparation: {
    primaryObjectives: string[];
    contingencyPlans: string[];
    keyMessages: string[];
    playerTargets: string[];
  };
  emotionalState:
    | "confident"
    | "nervous"
    | "suspicious"
    | "optimistic"
    | "defeated"
    | "determined";
  readyForTransition: boolean;
}

const phaseTransitionTemplate = `You are {{agentName}}, preparing for a phase transition in the Influence game. You need to analyze what just happened and prepare strategically for the next phase.

# Phase Transition Context
From Phase: {{fromPhase}}
To Phase: {{toPhase}}
Round: {{round}}

# Recent Conversation History
{{conversationHistory}}

# Current Strategic State
{{strategicContext}}

# Your Task
Analyze the recent conversations and prepare for the upcoming phase. Consider:

1. **Phase Assessment**: How ready are you for this transition? What did you learn?
2. **Conversation Analysis**: What key interactions happened? Who showed what behaviors?
3. **Strategic Shifts**: Do you need to change your strategy based on what you observed?
4. **Next Phase Preparation**: What are your objectives and plans for {{toPhase}}?

Be strategic, analytical, and honest about what you observed. This analysis will inform your actions in the next phase.

Respond with a detailed analysis in the following JSON format:
{
  "phaseAssessment": {
    "fromPhase": "{{fromPhase}}",
    "toPhase": "{{toPhase}}",
    "readiness": 0.8,
    "confidence": 0.7
  },
  "conversationAnalysis": {
    "keyInteractions": ["Player X made an aggressive statement", "Player Y tried to form alliance"],
    "playerBehaviors": [
      {
        "playerName": "PlayerName",
        "behavior": "aggressive/diplomatic/suspicious/etc",
        "trustChange": 0.2,
        "threatLevel": 0.3
      }
    ],
    "emergingAlliances": ["Player A + Player B", "Player C reaching out"],
    "detectedThreats": ["Player X targeting me", "Player Y seems dangerous"]
  },
  "strategicShifts": {
    "newPriorities": ["Form alliance with Player A", "Monitor Player B"],
    "tacticChanges": ["Be more aggressive", "Stay defensive", "Build trust"],
    "relationshipUpdates": [
      {
        "playerName": "PlayerName",
        "newAssessment": "potential ally/threat/neutral",
        "actionPlan": "what to do with this player"
      }
    ]
  },
  "nextPhasePreparation": {
    "primaryObjectives": ["Secure alliance", "Eliminate threat"],
    "contingencyPlans": ["If alliance fails...", "If threatened..."],
    "keyMessages": ["What to communicate to allies", "How to handle threats"],
    "playerTargets": ["Players to focus on in next phase"]
  },
  "emotionalState": "confident",
  "readyForTransition": true
}`;

/**
 * Action that handles strategic thinking during phase transitions
 * Triggered by STRATEGIC_THINKING_REQUIRED events
 */
export const phaseTransitionThinkingAction: Action = {
  name: "PHASE_TRANSITION_THINKING",
  description:
    "Perform strategic analysis and preparation during game phase transitions",

  examples: [], // This action is event-triggered, not conversational

  async validate(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> {
    // This action is only triggered by events, not by user messages
    // Check if this is in response to a STRATEGIC_THINKING_REQUIRED event
    const isStrategicThinking =
      message.content?.text?.includes("STRATEGIC_THINKING_REQUIRED") === true;

    // console.log(`🧠 [PhaseTransition] Validation check for ${runtime.character?.name}:`, {
    //   messageText: message.content?.text?.substring(0, 100),
    //   isStrategicThinking,
    //   messageId: message.id
    // });

    return isStrategicThinking;
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> {
    try {
      logger.info(
        `${runtime.character?.name} performing phase transition thinking`
      );

      // Get strategy service
      const strategyService = runtime.getService(
        "social-strategy"
      ) as StrategyService;
      if (!strategyService) {
        logger.warn(
          "StrategyService not available for phase transition thinking"
        );
        return false;
      }

      // Extract phase transition context from message
      const context = extractPhaseContext(message);
      if (!context) {
        logger.warn("Could not extract phase transition context");
        return false;
      }

      // Get recent conversation history for analysis
      const conversationHistory = await getRecentConversationHistory(
        runtime,
        message.roomId,
        context.fromPhase
      );

      // Get current strategic context
      const strategicState = strategyService.getState();
      const strategicContext = formatStrategicContext(strategicState);

      // Compose the strategic analysis prompt
      const prompt = composePrompt({
        template: phaseTransitionTemplate,
        state: {
          agentName: runtime.character?.name || "Agent",
          fromPhase: context.fromPhase,
          toPhase: context.toPhase,
          round: context.round.toString(),
          conversationHistory,
          strategicContext,
        },
      });

      logger.debug("Generating phase transition analysis", {
        fromPhase: context.fromPhase,
        toPhase: context.toPhase,
        conversationLength: conversationHistory.length,
      });

      // Generate strategic analysis using AI
      const analysisResult = await runtime.useModel(ModelType.OBJECT_SMALL, {
        prompt,
        temperature: 0.7,
      });

      if (!analysisResult) {
        logger.error("Failed to generate phase transition analysis");
        return false;
      }

      const analysis = analysisResult as PhaseTransitionAnalysis;

      // Process and store the strategic analysis
      await processTransitionAnalysis(
        runtime,
        strategyService,
        analysis,
        context
      );

      // Signal that strategic thinking is complete
      await signalStrategicThinkingComplete(runtime, message.roomId, context);

      logger.info(
        `Phase transition thinking completed for ${runtime.character?.name}`,
        {
          fromPhase: context.fromPhase,
          toPhase: context.toPhase,
          readiness: analysis.phaseAssessment.readiness,
          emotionalState: analysis.emotionalState,
        }
      );

      return true;
    } catch (error) {
      logger.error("Error in phase transition thinking:", error);
      return false;
    }
  },
};

/**
 * Extract phase transition context from the triggering message
 */
function extractPhaseContext(message: Memory): {
  fromPhase: Phase;
  toPhase: Phase;
  round: number;
  gameId: UUID;
} | null {
  try {
    // Parse context from message content or metadata
    const content = message.content.text;
    const fromPhaseMatch = content.match(/fromPhase:\s*(\w+)/);
    const toPhaseMatch = content.match(/toPhase:\s*(\w+)/);
    const roundMatch = content.match(/round:\s*(\d+)/);
    const gameIdMatch = content.match(/gameId:\s*([\w-]+)/);

    if (!fromPhaseMatch || !toPhaseMatch || !roundMatch || !gameIdMatch) {
      return null;
    }

    return {
      fromPhase: fromPhaseMatch[1] as Phase,
      toPhase: toPhaseMatch[1] as Phase,
      round: parseInt(roundMatch[1]),
      gameId: gameIdMatch[1] as UUID,
    };
  } catch (error) {
    logger.error("Error extracting phase context:", error);
    return null;
  }
}

/**
 * Get recent conversation history for strategic analysis
 */
async function getRecentConversationHistory(
  runtime: IAgentRuntime,
  roomId: UUID,
  fromPhase: Phase
): Promise<string> {
  try {
    // Get recent memories from the room
    const memories = await runtime.getMemories({
      roomId,
      count: 50, // Last 50 messages
      unique: false,
      tableName: "memories",
    });

    if (!memories || memories.length === 0) {
      return "No recent conversation history available.";
    }

    // Filter and format conversations
    const conversations = memories
      .filter((m) => m.content?.text && m.content.source !== runtime.agentId)
      .map((m) => `${m.content.source}: ${m.content.text}`)
      .slice(-20) // Last 20 relevant messages
      .join("\n");

    return conversations || "No relevant conversations found.";
  } catch (error) {
    logger.error("Error getting conversation history:", error);
    return "Error retrieving conversation history.";
  }
}

/**
 * Format strategic context for the prompt
 */
function formatStrategicContext(strategicState: any): string {
  try {
    const relationships = Array.from(strategicState.relationships.values())
      .map(
        (rel: any) =>
          `${rel.playerName}: Trust=${rel.trustLevel}, Threat=${rel.threat}`
      )
      .join("\n");

    const recentInsights = strategicState.diaryEntries
      .slice(-3)
      .flatMap((entry: any) => entry.observations)
      .join("\n");

    return `
Current Phase: ${strategicState.currentPhase}
Strategic Mode: ${strategicState.strategicMode}
Round: ${strategicState.round}

Relationships:
${relationships || "No established relationships"}

Recent Strategic Insights:
${recentInsights || "No recent insights"}

Analysis Confidence: ${Math.round(strategicState.analysis.confidenceLevel * 100)}%
    `.trim();
  } catch (error) {
    logger.error("Error formatting strategic context:", error);
    return "Strategic context unavailable.";
  }
}

/**
 * Process and store the transition analysis
 */
async function processTransitionAnalysis(
  runtime: IAgentRuntime,
  strategyService: StrategyService,
  analysis: PhaseTransitionAnalysis,
  context: any
): Promise<void> {
  try {
    // Update relationship assessments based on conversation analysis
    for (const behavior of analysis.conversationAnalysis.playerBehaviors) {
      // For this we need a UUID for the player - we'll need to look them up or skip for now
      // This is a limitation we'll need to address in the future
      logger.debug("Player behavior analysis recorded", {
        playerName: behavior.playerName,
        behavior: behavior.behavior,
        trustChange: behavior.trustChange,
        threatLevel: behavior.threatLevel,
      });
    }

    // Store strategic insights as diary entry
    const allowedEmotionalStates = [
      "confident",
      "nervous",
      "suspicious",
      "optimistic",
      "defeated",
    ] as const;
    const emotionalState = allowedEmotionalStates.includes(
      analysis.emotionalState as any
    )
      ? (analysis.emotionalState as (typeof allowedEmotionalStates)[number])
      : "confident"; // Default fallback

    await strategyService.addDiaryEntry({
      phase: context.toPhase,
      round: context.round,
      emotionalState,
      thoughts: `Phase transition analysis: ${context.fromPhase} → ${context.toPhase}`,
      observations: [
        ...analysis.conversationAnalysis.keyInteractions,
        ...analysis.strategicShifts.newPriorities,
      ],
      concerns: analysis.conversationAnalysis.detectedThreats,
      opportunities: analysis.nextPhasePreparation.primaryObjectives,
      strategyShift: analysis.strategicShifts.tacticChanges.join("; "),
    });

    logger.debug("Processed transition analysis", {
      behaviorUpdates: analysis.conversationAnalysis.playerBehaviors.length,
      strategicShifts: analysis.strategicShifts.newPriorities.length,
      emotionalState: analysis.emotionalState,
    });
  } catch (error) {
    logger.error("Error processing transition analysis:", error);
  }
}

/**
 * Signal that strategic thinking is complete
 */
async function signalStrategicThinkingComplete(
  runtime: IAgentRuntime,
  roomId: UUID,
  context: any
): Promise<void> {
  try {
    // Use coordination service to signal readiness to other agents
    const coordinationService = runtime.getService(
      "coordination"
    ) as CoordinationService;

    if (coordinationService) {
      await coordinationService.sendAgentReady(
        "strategic_thinking",
        context.gameId,
        roomId,
        {
          contextData: {
            fromPhase: context.fromPhase,
            toPhase: context.toPhase,
            round: context.round,
          },
        }
      );

      logger.info(
        `Strategic thinking complete signal sent via coordination for ${runtime.character?.name}`
      );
    } else {
      // Fallback to local events
      const eventData = {
        type: GameEventType.PLAYER_READY,
        payload: {
          gameId: context.gameId,
          roomId,
          playerId: runtime.agentId,
          playerName: runtime.character?.name || "Unknown",
          readyType: "strategic_thinking" as const,
          timestamp: Date.now(),
        },
      };

      await runtime.emitEvent(GameEventType.PLAYER_READY, eventData.payload);
      logger.info(
        `Strategic thinking complete signal sent locally for ${runtime.character?.name}`
      );
    }
  } catch (error) {
    logger.error("Error signaling strategic thinking complete:", error);
  }
}
