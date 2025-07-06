import type {
  Character,
  IAgentRuntime,
  ProjectAgent,
  Project,
} from "@elizaos/core";
import { socialStrategyPlugin } from "./plugins/socialStrategy/index";
import alexCharacter from "./characters/alex";
import bethanyCharacter from "./characters/bethany";

function makeAgent(character: Character): ProjectAgent {
  return {
    character,
    init: async (runtime: IAgentRuntime) => {
      // optional per-agent initialization
    },
    plugins: [socialStrategyPlugin],
  };
}

export const projectAgents: ProjectAgent[] = [
  makeAgent(alexCharacter),
  makeAgent(bethanyCharacter),
];

export const project: Project = {
  agents: projectAgents,
};
