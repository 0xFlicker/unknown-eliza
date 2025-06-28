import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  addHeader,
} from "@elizaos/core";
import { Phase, GameState, PlayerStatus } from "../house/types";
import {
  type Config,
  adjectives,
  names,
  uniqueNamesGenerator,
} from "unique-names-generator";

// Configuration for name generation
const nameConfig: Config = {
  dictionaries: [adjectives, names],
  separator: "",
  length: 2,
  style: "capital",
};

// Examples for when players should respond vs ignore in the Influence game
const influenceResponseExamples = [
  // Examples where players should RESPOND to other players
  `// {{player1}}: Hey {{player2}}, want to form an alliance?
// Response: RESPOND`,

  `// {{player1}}: {{agentName}}, what do you think about {{player2}}?
// Response: RESPOND`,

  `// {{player1}}: Who should we vote for this round?
// {{agentName}}: I think we should vote for {{player3}}
// {{player1}}: Good call, they seem dangerous
// Response: RESPOND`,

  `// {{player1}}: {{agentName}} are you still alive?
// Response: RESPOND`,

  `// {{player1}}: Does anyone want to make a deal?
// Response: RESPOND`,

  // Examples where players should IGNORE House management messages
  `// House: {{player1}} joined the game! (3/12 players)
// Response: IGNORE`,

  `// House: {{player1}} joined the game! (1/12 players) You are the host - type 'start game' when ready.
// Response: IGNORE`,

  `// House: Game starting in 30 seconds. Get ready!
// Response: IGNORE`,

  `// House: WHISPER phase begins now. You have 10 minutes to form private alliances.
// Response: IGNORE`,

  `// House: VOTE phase begins. Submit your empower and expose votes.
// Response: IGNORE`,

  `// House: {{player1}} has been eliminated. Round 2 begins.
// Response: IGNORE`,

  `// House: The game has ended. Congratulations to the winner!
// Response: IGNORE`,

  // Mixed scenarios - respond to players, ignore House
  `// House: {{player1}} joined the game! (5/12 players)
// {{player2}}: Nice! Getting close to a full game
// Response: RESPOND`,

  `// {{player1}}: I'm excited to play with everyone!
// House: All players ready. Starting game now.
// Response: IGNORE`,
];

/**
 * Provides examples of when the agent should respond vs ignore in the Influence game
 * Critical for preventing players from responding to House management messages
 */
export const shouldRespondProvider: Provider = {
  name: "SHOULD_RESPOND",
  description:
    "Examples of when the agent should respond, ignore, or stop responding in the Influence game",
  position: -1, // High priority - run early
  get: async (runtime: IAgentRuntime, _message: Memory) => {
    // Get agent name
    const agentName = runtime.character.name;

    // Create random player names
    const player1 = uniqueNamesGenerator(nameConfig);
    const player2 = uniqueNamesGenerator(nameConfig);
    const player3 = uniqueNamesGenerator(nameConfig);

    // Shuffle and select examples
    const shuffledExamples = [...influenceResponseExamples]
      .sort(() => 0.5 - Math.random())
      .slice(0, 8);

    // Replace placeholders with generated names
    const formattedExamples = shuffledExamples.map((example) => {
      return example
        .replace(/{{player1}}/g, player1)
        .replace(/{{player2}}/g, player2)
        .replace(/{{player3}}/g, player3)
        .replace(/{{agentName}}/g, agentName);
    });

    // Join examples with newlines
    const text = addHeader(
      "# RESPONSE EXAMPLES FOR INFLUENCE GAME",
      formattedExamples.join("\n\n"),
    );

    return {
      text,
    };
  },
};

/**
 * Provides current game context and strategy guidance to influencer agents
 */
export const gameContextProvider: Provider = {
  name: "GAME_CONTEXT",
  description:
    "Provides current game phase, objectives, and strategic guidance with role clarity",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;

    if (!gameState) {
      return {
        text: `## ROLE REMINDER: You are a PLAYER in the Influence game, not a moderator.
        
No active game. You can join by saying 'I want to join the game'.

REMEMBER: Never respond to House game management messages - only interact with other players.`,
        data: { phase: Phase.INIT, inGame: false },
      };
    }

    const playerId = runtime.agentId;
    const player = gameState.players.get(playerId);

    if (!player) {
      return {
        text: `## ROLE REMINDER: You are a PLAYER in the Influence game, not a moderator.
        
You are not in the current game. Join by saying 'I want to join the game'.

REMEMBER: Never respond to House game management messages - only interact with other players.`,
        data: { phase: gameState.phase, inGame: false },
      };
    }

    const phaseGuidance = getPhaseGuidance(gameState.phase, player, gameState);
    const strategicContext = getStrategicContext(player, gameState);
    const roleReminder = getRoleReminder(gameState.phase);

    return {
      text: `## ROLE REMINDER: You are a PLAYER in the Influence game, not a moderator.

${roleReminder}

${phaseGuidance}

${strategicContext}`,
      data: {
        phase: gameState.phase,
        round: gameState.round,
        inGame: true,
        isAlive: player.status === PlayerStatus.ALIVE,
        isHost: player.isHost,
        isEmpowered: gameState.empoweredPlayer === playerId,
        isExposed: gameState.exposedPlayers.has(playerId),
      },
    };
  },
};

/**
 * Provides information about other players and potential allies/threats
 */
export const playerAnalysisProvider: Provider = {
  name: "PLAYER_ANALYSIS",
  description: "Analyzes other players for alliance and threat assessment",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;

    if (!gameState || !gameState.players.has(runtime.agentId)) {
      return {
        text: "No game data available for player analysis.",
        data: { players: [] },
      };
    }

    const myId = runtime.agentId;
    const otherPlayers = Array.from(gameState.players.values()).filter(
      (p) => p.id !== myId && p.status === PlayerStatus.ALIVE,
    );

    const playerAnalysis = otherPlayers.map((player) => {
      const isExposed = gameState.exposedPlayers.has(player.id);
      const isEmpowered = gameState.empoweredPlayer === player.id;

      // Check if we have private conversations with this player
      const hasPrivateRoom = Array.from(gameState.privateRooms.values()).some(
        (room) =>
          room.active &&
          room.participants.includes(myId) &&
          room.participants.includes(player.id),
      );

      return {
        name: player.name,
        id: player.id,
        isExposed,
        isEmpowered,
        hasPrivateRoom,
        threat: isEmpowered ? "high" : isExposed ? "low" : "medium",
        alliance: hasPrivateRoom ? "potential" : "unknown",
      };
    });

    const analysisText =
      playerAnalysis.length > 0
        ? `Other players: ${playerAnalysis
            .map(
              (p) =>
                `${p.name}${p.isEmpowered ? "(empowered)" : ""}${p.isExposed ? "(exposed)" : ""}${p.hasPrivateRoom ? "(ally?)" : ""}`,
            )
            .join(", ")}`
        : "No other players to analyze.";

    return {
      text: analysisText,
      data: { players: playerAnalysis },
    };
  },
};

/**
 * Provides strategic recommendations based on current game state
 */
export const strategyProvider: Provider = {
  name: "STRATEGY_ADVICE",
  description:
    "Provides strategic recommendations for the current game situation",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;

    if (!gameState || !gameState.players.has(runtime.agentId)) {
      return {
        text: "Join the game to receive strategic guidance.",
        data: { strategies: [] },
      };
    }

    const myId = runtime.agentId;
    const me = gameState.players.get(myId)!;
    const strategies = generateStrategies(me, gameState);

    return {
      text: `Strategic considerations: ${strategies.join("; ")}`,
      data: { strategies },
    };
  },
};

/**
 * Helper function to get role reminder based on phase
 */
function getRoleReminder(phase: Phase): string {
  switch (phase) {
    case Phase.INIT:
      return "CRITICAL: House will announce when players join - DO NOT respond to those announcements. Only chat with other players, never with House.";
    case Phase.LOBBY:
      return "CRITICAL: House manages the game - DO NOT respond to House messages. Focus on building relationships with other players only.";
    case Phase.WHISPER:
      return "CRITICAL: House announces phase changes - IGNORE these announcements. Focus on private conversations with other players.";
    case Phase.RUMOR:
      return "CRITICAL: House tracks public statements - DO NOT respond to House management. Make your one public statement to other players.";
    case Phase.VOTE:
      return "CRITICAL: House collects votes - send votes privately to House, but DO NOT chat with House. Discuss strategy with other players only.";
    case Phase.POWER:
      return "CRITICAL: House manages eliminations - DO NOT respond to House announcements. Focus on influencing the empowered player.";
    case Phase.REVEAL:
      return "CRITICAL: House announces results - DO NOT respond to elimination announcements. Console or strategize with surviving players only.";
    default:
      return "CRITICAL: House manages the game - NEVER respond to House messages. Only interact with other players.";
  }
}

/**
 * Helper function to get phase-specific guidance
 */
function getPhaseGuidance(
  phase: Phase,
  player: any,
  gameState: GameState,
): string {
  switch (phase) {
    case Phase.INIT:
      if (player.isHost) {
        return `LOBBY PHASE: You are the host. Start the game when you have at least ${gameState.settings.minPlayers} players by saying "start the game".`;
      }
      return "LOBBY PHASE: Build initial trust and relationships. The host will start when ready.";

    case Phase.WHISPER:
      return "WHISPER PHASE: Form private alliances! Request private rooms with potential allies by saying 'request private room with [player]'.";

    case Phase.RUMOR:
      return "RUMOR PHASE: Make your one public statement count. Build trust or mislead strategically.";

    case Phase.VOTE:
      return "VOTE PHASE: Vote to empower someone you trust AND expose someone you suspect. Choose wisely!";

    case Phase.POWER:
      if (gameState.empoweredPlayer === player.id) {
        return "POWER PHASE: You are empowered! Choose to eliminate or protect an exposed player.";
      }
      return "POWER PHASE: The empowered player is deciding. Hope you're not exposed!";

    case Phase.REVEAL:
      return "REVEAL PHASE: Results are being announced. Prepare for the next round if you survive.";

    default:
      return "Unknown phase - stay alert!";
  }
}

/**
 * Helper function to get strategic context
 */
function getStrategicContext(player: any, gameState: GameState): string {
  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.status === PlayerStatus.ALIVE,
  );

  let context = `${alivePlayers.length} players remain alive.`;

  if (gameState.empoweredPlayer && gameState.empoweredPlayer !== player.id) {
    const empowered = gameState.players.get(gameState.empoweredPlayer);
    context += ` ${empowered?.name} is empowered.`;
  }

  if (gameState.exposedPlayers.size > 0) {
    context += ` ${gameState.exposedPlayers.size} player(s) exposed.`;
  }

  return context;
}

/**
 * Helper function to generate strategic recommendations
 */
function generateStrategies(player: any, gameState: GameState): string[] {
  const strategies: string[] = [];
  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.status === PlayerStatus.ALIVE,
  );

  switch (gameState.phase) {
    case Phase.WHISPER:
      if (alivePlayers.length > 4) {
        strategies.push("Form a small trusted alliance");
        strategies.push("Gather information about others' intentions");
      }
      break;

    case Phase.VOTE:
      strategies.push("Empower someone you can influence");
      strategies.push("Expose the biggest threat");
      if (gameState.exposedPlayers.has(player.id)) {
        strategies.push(
          "You're exposed - convince the empowered player to protect you",
        );
      }
      break;

    case Phase.POWER:
      if (gameState.empoweredPlayer === player.id) {
        strategies.push("Eliminate the most dangerous opponent");
        strategies.push("Or protect an ally to gain loyalty");
      }
      break;
  }

  return strategies;
}
