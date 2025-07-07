import { Character } from "@elizaos/core";

const basePlayer: Omit<Character, "name"> = {
  bio: "",
};

export default basePlayer;
