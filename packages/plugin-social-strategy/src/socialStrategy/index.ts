import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Provider,
  State,
  type UUID,
  logger,
} from "@elizaos/core";
import { trackConversation } from "./actions/trackConversation";
import type { SocialStrategyState } from "./types";
import {
  SocialStrategyPromptBuilder,
  type ModelWorkload,
} from "./promptManager";
import { getParticipantsForRoom } from "../safeUtils";

// Helper function to build analysis prompts
export function buildAnalysisPrompt(
  text: string,
  speakingPlayer: string,
  mentionedPlayers: string[]
): string {
  const playerList =
    mentionedPlayers.length > 0 ? mentionedPlayers.join(", ") : "None";

  return `Analyze this conversation and provide insights about player relationships and trust.

Conversation: "${text}"
Speaker: ${speakingPlayer || "Unknown"}
Mentioned Players: ${playerList}

Please provide a JSON response ONLY with the following structure:
{
  "trustScore": <number between 0-100>,
  "relationship": "<ally|neutral|rival>",
  "statement": "<brief analysis of the interaction>",
  "metadata": {
    "interactionType": "<positive|negative|neutral>",
    "sentiment": "<positive|negative|neutral>",
    "confidence": <number between 0-1>
  }
}

No additional text or formatting, just the JSON object.

Analysis:`;
}

export const getPlayerInfoHandler = async (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
) => {
  const socialState = (state?.socialStrategyState as SocialStrategyState) || {
    players: {},
    relationships: [],
    statements: [],
    metadata: { lastAnalysis: Date.now(), version: "1.0.0" },
  };
  const { playerId } = message.content as { playerId: UUID };

  const player = socialState.players[playerId];
  if (!player) {
    return {
      success: false,
      message: "Player not found",
    };
  }

  // Get relationships involving this player
  const relationships = socialState.relationships.filter((rel) => {
    const sourceId = rel.sourcePlayerId;
    const targetId = rel.targetPlayerId;
    return sourceId === playerId || targetId === playerId;
  });

  // Get statements about this player
  const statements = socialState.statements.filter((stmt) => {
    const targetId = stmt.targetId;
    return targetId === playerId;
  });

  return {
    success: true,
    data: {
      player,
      relationships,
      statements,
    },
  };
};

export const socialStrategyPlugin: Plugin = {
  // Ensure connections default to conversation when type is undefined
  init: async (_config, runtime) => {
    const originalEnsureConnection = runtime.ensureConnection.bind(runtime);
    runtime.ensureConnection = async (params) => {
      const fixedType = params.type ?? "conversation";
      return originalEnsureConnection({ ...params, type: fixedType });
    };
  },
  name: "social-strategy",
  description:
    "Tracks and manages player relationships and trust scores for social strategy analysis",
  providers: [
    {
      name: "social-context",
      description:
        "Provides formatted social context (players, trust scores, top relationships, recent statements) for prompt injection",
      get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        const { roomId } = message;
        // -------------------------
        // 1. Gather data from runtime
        // -------------------------
        const participantIds = await getParticipantsForRoom(runtime, roomId);
        const participants: Array<{ id?: UUID; names: string[] }> = [];
        for (const id of participantIds) {
          const ent = await runtime.getEntityById(id);
          if (ent) {
            participants.push({ id: ent.id, names: ent.names });
          }
        }

        // Build runtime-derived players list (may be empty in tests)
        const runtimePlayers = participants.map((e) => ({
          handle: e.names[0],
          trustScore: 50, // placeholder, will be overridden if state contains richer data
        }));

        // Build a map for quick id→handle lookup
        const playerMap: Record<string, string> = {};
        for (const e of participants) {
          if (e.id) playerMap[e.id] = e.names[0];
        }

        // -------------------------
        // 2. Runtime relationships & statements
        // -------------------------
        const relSet = new Set<string>();
        const runtimeRelationships: Array<{
          source: string;
          target: string;
          relationshipType: string;
          strength: number;
        }> = [];
        for (const e of participants) {
          if (!e.id) continue;
          const rels = await runtime.getRelationships({ entityId: e.id });
          for (const r of rels) {
            const key = `${r.sourceEntityId}-${r.targetEntityId}`;
            if (relSet.has(key)) continue;
            relSet.add(key);
            runtimeRelationships.push({
              source: playerMap[r.sourceEntityId] ?? r.sourceEntityId,
              target: playerMap[r.targetEntityId] ?? r.targetEntityId,
              relationshipType: r.tags?.[0] ?? "",
              strength: (r.metadata as any)?.strength ?? 0,
            });
          }
        }

        const runtimeStatements: Array<{
          speaker: string;
          target: string;
          content: string;
        }> = [];
        for (const e of participants) {
          if (!e.id) continue;
          const comps = await runtime.getComponents(e.id);
          for (const c of comps) {
            if (c.type === "social-strategy-statement") {
              const targetId = c.data.targetEntityId as UUID;
              runtimeStatements.push({
                speaker: playerMap[c.entityId] ?? c.entityId,
                target: playerMap[targetId] ?? targetId,
                content: (c.data as any).content,
              });
            }
          }
        }

        // -------------------------
        // 3. Fallback/merge with in-memory SocialStrategyState
        // -------------------------
        let players = [...runtimePlayers];
        let relationships = [...runtimeRelationships];
        let statements = [...runtimeStatements];

        const socialState = (state as any)?.socialStrategyState as
          | SocialStrategyState
          | undefined;
        if (socialState) {
          // Players from state
          const statePlayersArr = Object.values(socialState.players).map(
            (p) => ({
              handle: p.handle,
              trustScore: p.trustScore,
            })
          );

          // Merge player handles, preferring state trustScore values
          const seenHandles = new Map<string, number>();
          for (const sp of statePlayersArr) {
            seenHandles.set(sp.handle, sp.trustScore);
          }
          for (const rp of players) {
            if (!seenHandles.has(rp.handle)) {
              seenHandles.set(rp.handle, rp.trustScore);
            }
          }
          players = Array.from(seenHandles.entries()).map(
            ([handle, trustScore]) => ({
              handle,
              trustScore,
            })
          );

          // Build id→handle map from state for relationships/statement conversion
          const idToHandle: Record<string, string> = {};
          for (const [id, p] of Object.entries(socialState.players)) {
            idToHandle[id] = p.handle;
          }

          // Relationships from state
          const stateRelationships = socialState.relationships.map((rel) => ({
            source: idToHandle[rel.sourcePlayerId] ?? rel.sourcePlayerId,
            target: idToHandle[rel.targetPlayerId] ?? rel.targetPlayerId,
            relationshipType: rel.relationshipType,
            strength: rel.strength,
          }));

          // Merge (avoid duplicates by simple key)
          const relKey = (r: any) => `${r.source}-${r.target}`;
          const allRels = [...relationships, ...stateRelationships];
          const uniqueRelMap = new Map<string, (typeof allRels)[0]>();
          for (const r of allRels) {
            uniqueRelMap.set(relKey(r), r);
          }
          relationships = Array.from(uniqueRelMap.values());

          // Statements from state – convert to readable form
          const stateStatements = socialState.statements.map((stmt) => ({
            speaker: idToHandle[stmt.speakerId] ?? stmt.speakerId,
            target: idToHandle[stmt.targetId] ?? stmt.targetId,
            content: stmt.content,
          }));
          statements = [...statements, ...stateStatements];
        }

        const recentStatements = statements.slice(-5);
        const socialContext = { players, relationships, recentStatements };

        // ----------------------------------------------------
        // 4. If no relevant data, return empty provider result
        // ----------------------------------------------------
        if (
          players.length === 0 &&
          relationships.length === 0 &&
          recentStatements.length === 0
        ) {
          return {
            data: { socialContext: null },
            values: { socialContext: "" },
            text: "",
          };
        }

        // ----------------------------------------------------
        // 5. Build user-friendly prompt using PromptManager
        // ----------------------------------------------------

        const friendlyContextLines: string[] = [];

        // Players section
        if (players.length > 0) {
          friendlyContextLines.push("Players:");
          for (const p of players) {
            friendlyContextLines.push(`- ${p.handle} (Trust: ${p.trustScore})`);
          }
          friendlyContextLines.push("");
        }

        // Relationships section
        if (relationships.length > 0) {
          friendlyContextLines.push("Relationships:");
          for (const r of relationships) {
            friendlyContextLines.push(
              `- ${r.source} -> ${r.target} (${r.relationshipType}, strength ${r.strength})`
            );
          }
          friendlyContextLines.push("");
        }

        // Recent statements section
        if (recentStatements.length > 0) {
          friendlyContextLines.push("Recent Statements:");
          for (const s of recentStatements) {
            const snippet =
              s.content.length > 100 ? `${s.content.slice(0, 97)}…` : s.content;
            friendlyContextLines.push(
              `- ${s.speaker} about ${s.target}: "${snippet}"`
            );
          }
        }

        const friendlyContext = friendlyContextLines.join("\n");

        const prompt = new SocialStrategyPromptBuilder()
          .withWorkload("RELATIONSHIP_ANALYSIS" as ModelWorkload)
          .withMetadata("roomId", roomId ?? "unknown")
          .withPrompt(friendlyContext)
          .build().prompt;

        const contextString = JSON.stringify(socialContext);

        return {
          data: { socialContext },
          values: { socialContext: contextString, socialPrompt: prompt },
          text: prompt,
        };
      },
    },
  ],

  actions: [
    trackConversation,
    {
      name: "getPlayerInfo",
      description: "Retrieve information about a specific player",
      similes: ["PLAYER_INFO", "LOOKUP_PLAYER", "PLAYER_PROFILE"],
      examples: [
        [
          {
            name: "user",
            content: { playerId: "player1", text: "Get info for player1" },
          },
          {
            name: "agent",
            content: {
              text: "Player info for player1: trust 50, neutral relationship.",
              actions: ["getPlayerInfo"],
            },
          },
        ],
      ],
      validate: async (runtime: IAgentRuntime, message: Memory) => {
        return (
          typeof message.content === "object" &&
          message.content !== null &&
          "playerId" in message.content &&
          typeof message.content.playerId === "string"
        );
      },
      handler: getPlayerInfoHandler,
    },
  ],
};

export { trackConversation } from "./actions/trackConversation";
export * from "./types";
