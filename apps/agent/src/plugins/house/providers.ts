import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ModelType,
  UUID,
} from "@elizaos/core";
import { Phase } from "@/game/types";
import { getGameState } from "../../memory/runtime";
import { createPhaseMachine } from "@/game/phase";
import { createActor } from "xstate";

/**
 * Provides current game state information to the House agent
 */
export const gameStateProvider: Provider = {
  name: "GAME_STATE",
  description:
    "Provides information about the current game state, phase, and players",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // const component = await runtime.getComponent(
    const gameState = await getGameState(runtime, message.roomId);

    if (!gameState) {
      return {
        text: "No active game. Players can join by saying 'join game'.",
        data: { phase: Phase.INIT, hasGame: false },
      };
    }
    const phaseActor = createActor(createPhaseMachine(gameState.gameSettings), {
      input: gameState.phaseInput,
      snapshot: gameState?.phaseSnapshot,
    });

    const snapshot = phaseActor.getSnapshot();

    const stateText = `The current phase is ${snapshot.value}`;

    return {
      text: stateText,
      data: {
        phase: snapshot.value,
        players: snapshot.context.players,
      },
    };
  },
};

/**
 * Helper function to get phase description
 */
function getPhaseDescription(phase: Phase): string {
  switch (phase) {
    case Phase.INIT:
      return "Waiting room - players joining";
    case Phase.LOBBY:
      return "Public mixer - free chat in main channel";
    case Phase.WHISPER:
      return "Private conversations and alliance building";
    case Phase.RUMOR:
      return "Public messaging phase - one message per player";
    case Phase.VOTE:
      return "Voting phase - empower one, expose any";
    case Phase.POWER:
      return "Empowered player must eliminate or protect";
    case Phase.REVEAL:
      return "Results revealed";
    default:
      return "Unknown phase";
  }
}

/**
 * Helper function to get available actions for a phase
 */
function getAvailableActions(phase: Phase): string[] {
  switch (phase) {
    case Phase.INIT:
      return ["join game", "start game (host only)"];
    case Phase.LOBBY:
      return ["chat freely", "form initial impressions"];
    case Phase.WHISPER:
      return ["request private room with [player]", "whisper privately"];
    case Phase.RUMOR:
      return ["post public message"];
    case Phase.VOTE:
      return ["empower [player]", "expose [player]"];
    case Phase.POWER:
      return ["eliminate [exposed player]", "protect [exposed player]"];
    case Phase.REVEAL:
      return ["wait for results"];
    default:
      return [];
  }
}
