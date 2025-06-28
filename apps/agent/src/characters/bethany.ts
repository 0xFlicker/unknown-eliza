import type { Character } from "@elizaos/core";
import alexCharacter from "./alex";

const bethanyCharacter: Character = {
  ...alexCharacter,
  name: "Bethany",
  bio: [...alexCharacter.bio.slice(0, 2), ...alexCharacter.bio.slice(-2)], // Include the critical House instructions
  messageExamples: alexCharacter.messageExamples.slice(0, 2),
};

export default bethanyCharacter;
