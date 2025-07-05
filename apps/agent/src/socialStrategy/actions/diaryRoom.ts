import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  stringToUuid,
  ModelType,
  composePrompt,
  parseJSONObjectFromText,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { Phase } from "../../house/types";
import { CoordinationService } from "src/house/coordination";

const logger = elizaLogger;

interface DiaryRoomRequest {
  type: "diary" | "reflection" | "analysis";
  subject?: string; // Specific player or topic to focus on
  urgent?: boolean; // Whether this is an urgent strategic review
}

interface DiaryRoomResponse {
  thoughts: string;
  emotionalState:
    | "confident"
    | "nervous"
    | "suspicious"
    | "optimistic"
    | "defeated";
  observations: string[];
  concerns: string[];
  opportunities: string[];
  strategyShift?: string;
  nextMoves: string[];
}

const diaryRoomTemplate = `You are in your private diary room. This is your space for honest strategic thinking about the Influence game. No other players can see this.

# Current Situation
{{currentContext}}

# Recent Game Events
{{recentEvents}}

# Your Strategic State
{{strategicState}}

# Diary Request
Type: {{requestType}}
{{subjectFocus}}

# Task
Create a private diary entry with your honest strategic thoughts. Consider:
- Your current emotional state and confidence
- Key observations about the game situation
- Immediate concerns and threats
- Opportunities you can exploit
- Whether you need to change your strategy
- Specific actions you should take next

Be completely honest - this is private reflection for strategic advantage.

Respond in this format:
{
  "thoughts": "Your honest strategic analysis and inner thoughts",
  "emotionalState": "confident|nervous|suspicious|optimistic|defeated",
  "observations": ["key observation 1", "key observation 2"],
  "concerns": ["concern 1", "threat 2"],
  "opportunities": ["opportunity 1", "advantage 2"],
  "strategyShift": "description of any strategy changes needed",
  "nextMoves": ["specific action 1", "tactical move 2"]
}`;

export const diaryRoomAction: Action = {
  name: "DIARY_ROOM",
  description:
    "Create private strategic diary entries and reflections for game analysis",
  similes: [
    "REFLECT_STRATEGY",
    "PRIVATE_THOUGHTS",
    "STRATEGIC_ANALYSIS",
    "DIARY_ENTRY",
    "INNER_MONOLOGUE",
    "STRATEGIC_PLANNING",
  ],

  examples: [
    [
      {
        name: "user",
        content: {
          text: "I need to think about my strategy privately",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Let me reflect on the current strategic situation in my diary room.",
          action: "DIARY_ROOM",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "What do you really think about Alice's move?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "I should analyze Alice's actions privately in my diary room to develop a strategic response.",
          action: "DIARY_ROOM",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "The phase is changing - update your strategy",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Time for a strategic review in my diary room to adapt to the new phase.",
          action: "DIARY_ROOM",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> => {
    // Only validate that we have a strategy service and a text message
    const strategyService = runtime.getService("social-strategy");
    const hasBasicRequirements = !!(
      strategyService &&
      message.content?.text &&
      typeof message.content.text === "string"
    );

    if (!hasBasicRequirements) {
      return false;
    }

    return true;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      console.log(
        `📔 [DiaryRoom] Handler executing for ${runtime.character?.name}`,
        {
          messageText: message.content?.text?.substring(0, 100),
          messageId: message.id,
        }
      );

      const strategyService = runtime.getService(
        "social-strategy"
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[DiaryRoom] StrategyService not available");
        // console.log(`❌ [DiaryRoom] No strategy service for ${runtime.character?.name}`);
        return false;
      }

      const text = message.content?.text || "";

      // Get current strategic context
      const strategyState = strategyService.getState();
      const config = strategyService.getConfiguration();

      // Get entities and recent messages for context
      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: "messages",
        count: 10,
        unique: false,
      });

      // Build context for diary entry
      const currentContext = await buildCurrentContext(strategyState, entities);
      const recentEvents = formatRecentEvents(
        recentMessages,
        entities,
        runtime.agentId
      );
      const strategicStateText = formatStrategicState(strategyState);

      const prompt = composePrompt({
        template: config.diaryReflection || diaryRoomTemplate,
        state: {
          currentContext,
          recentEvents,
          strategicState: strategicStateText,
          requestType: "diary",
          subjectFocus: "All players",
        },
      });

      // Generate diary entry
      const diaryResponsePrompt = await runtime.useModel(
        ModelType.OBJECT_SMALL,
        {
          prompt,
        }
      );

      const diaryResponse = parseJSONObjectFromText(
        diaryResponsePrompt
      ) as DiaryRoomResponse;
      if (!diaryResponse) {
        logger.warn("[DiaryRoom] Failed to parse diary response");
        return false;
      }

      if (!diaryResponse || !diaryResponse.thoughts) {
        logger.warn("[DiaryRoom] Failed to generate diary entry");
        return false;
      }

      // Create diary entry in strategy service
      const diaryEntry = await strategyService.addDiaryEntry({
        round: strategyState.round,
        phase: strategyState.currentPhase,
        thoughts: diaryResponse.thoughts,
        observations: diaryResponse.observations || [],
        strategyShift: diaryResponse.strategyShift,
        emotionalState: diaryResponse.emotionalState || "optimistic",
        concerns: diaryResponse.concerns || [],
        opportunities: diaryResponse.opportunities || [],
      });

      // Log privately (not sent to chat)
      logger.info("[DiaryRoom] Created strategic diary entry", {
        phase: strategyState.currentPhase,
        round: strategyState.round,
        emotionalState: diaryResponse.emotionalState,
        observationsCount: diaryResponse.observations?.length || 0,
        concernsCount: diaryResponse.concerns?.length || 0,
        opportunitiesCount: diaryResponse.opportunities?.length || 0,
        hasStrategyShift: !!diaryResponse.strategyShift,
      });

      // The diary room is completely private - no public responses
      // Strategic thinking happens silently in the background

      // const coordinationService = runtime.getService<CoordinationService>(
      //   CoordinationService.serviceType
      // );

      return {
        text: diaryResponse.thoughts,
        actions: ["REPLY"],
      };
    } catch (error) {
      logger.error("[DiaryRoom] Error creating diary entry:", error);
      return false;
    }
  },
};

async function buildCurrentContext(
  strategyState: any,
  entities: any[]
): Promise<string> {
  const alivePlayers = entities.filter(
    (e) => e.id !== strategyState.agentId
  ).length;
  const allies = Array.from(strategyState.relationships.values()).filter(
    (rel: any) => rel.trustLevel === "ally"
  ).length;
  const threats = Array.from(strategyState.relationships.values()).filter(
    (rel: any) => rel.trustLevel === "threat" || rel.trustLevel === "enemy"
  ).length;

  return `Phase: ${strategyState.currentPhase}
Round: ${strategyState.round}
Players Alive: ${alivePlayers}
My Allies: ${allies}
Known Threats: ${threats}
Confidence: ${Math.round(strategyState.analysis.confidenceLevel * 100)}%`;
}

function formatRecentEvents(
  messages: Memory[],
  entities: any[],
  agentId: string
): string {
  const recentEvents = messages
    .reverse()
    .slice(-5)
    .map((msg) => {
      const senderName = getEntityName(entities, msg.entityId);
      const text = msg.content?.text || "";
      return `${senderName}: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`;
    })
    .join("\n");

  return recentEvents || "No recent events to analyze";
}

function formatStrategicState(strategyState: any): string {
  const relationshipCount = strategyState.relationships.size;
  const lastDiary =
    strategyState.diaryEntries.length > 0
      ? strategyState.diaryEntries[strategyState.diaryEntries.length - 1]
      : null;

  return `Tracked Relationships: ${relationshipCount}
Strategic Mode: ${strategyState.strategicMode}
Last Diary Entry: ${lastDiary ? `${lastDiary.emotionalState} (Round ${lastDiary.round})` : "None"}
Next Planned Moves: ${strategyState.analysis.nextMoves.length}`;
}

function getEntityName(entities: any[], entityId: string): string {
  const entity = entities.find((e) => e.id === entityId);
  return entity?.names[0] || entityId.slice(0, 8);
}
