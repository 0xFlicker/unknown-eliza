import { Provider } from "@elizaos/core";
import { Phase } from "../house/types";

/**
 * Provides lobby-phase instructions to influencer agents.
 * In the lobby (INIT), each agent has three public messages to build alliances and trust.
 */
export const lobbyContextProvider: Provider = {
  name: "LOBBY_CONTEXT",
  description:
    "Informs the agent that it is the lobby phase and remaining messages",
  get: async (_runtime, _message, state) => {
    const phase = state?.values?.phase as Phase | undefined;
    const remaining = 3;
    return {
      text: `Phase: ${phase || Phase.INIT}. You have ${remaining} public messages to build alliances and trust.`,
      data: { phase, remaining },
    };
  },
};
