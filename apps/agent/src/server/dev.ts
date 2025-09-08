import "dotenv/config";
import houseCharacter from "../characters/house";
import { InfluenceApp } from "./influence-app";
import {
  AgentConfig,
  ChannelConfig,
  ParticipantState,
  ParticipantMode,
  DefaultAgentContext,
} from "./types";
import { Character, ChannelType, IAgentRuntime } from "@elizaos/core";
import {
  alexCharacter,
  bethanyCharacter,
  chloeCharacter,
  elenaCharacter,
  ethanCharacter,
  marcusCharacter,
  mayaCharacter,
  ryanCharacter,
} from "@/characters/allPlayers";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { housePlugin } from "../../src/plugins/house";
import { influencerPlugin } from "../../src/plugins/influencer";
import { coordinatorPlugin } from "@/plugins/coordinator";

/**
 * Example usage of the production-ready agent and channel management system
 * This demonstrates how to properly handle the n² complexity of agent-channel associations
 */
export async function start() {
  // Create the app with configuration
  const app = new InfluenceApp<
    DefaultAgentContext,
    {
      environment: string;
      version: string;
    },
    IAgentRuntime
  >({
    dataDir: "./.elizaos/data",
    serverPort: 3333,
    context: {
      environment: "production",
      version: "0.0.1",
    },
    houseConfig: {
      maxPlayers: 16,
      minPlayers: 5,
      autoStartGame: true,
    },
  });

  // Initialize the app
  await app.initialize();

  // Add agents to the system
  console.log("Adding agents...");

  const houseAgent = await app.addAgent({
    character: houseCharacter,
    plugins: [bootstrapPlugin, sqlPlugin as any, openaiPlugin, housePlugin],
    metadata: { role: "house", entityName: "House" },
  });

  const alexAgent = await app.addAgent({
    character: alexCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Alex" },
  });

  const bethanyAgent = await app.addAgent({
    character: bethanyCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Bethany" },
  });

  const chloeAgent = await app.addAgent({
    character: chloeCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Chloe" },
  });

  const elenaAgent = await app.addAgent({
    character: elenaCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Elena" },
  });

  const ethanAgent = await app.addAgent({
    character: ethanCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Ethan" },
  });

  const marcusAgent = await app.addAgent({
    character: marcusCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Marcus" },
  });

  const mayaAgent = await app.addAgent({
    character: mayaCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Maya" },
  });

  const ryanAgent = await app.addAgent({
    character: ryanCharacter,
    plugins: [coordinatorPlugin, influencerPlugin, sqlPlugin, openaiPlugin],
    metadata: { role: "player", entityName: "Ryan" },
  });

  console.log(
    `Added agents: ${houseAgent.character.name}, ${alexAgent.character.name}, ${bethanyAgent.character.name}, ${chloeAgent.character.name}, ${elenaAgent.character.name}, ${ethanAgent.character.name}, ${marcusAgent.character.name}, ${mayaAgent.character.name}, ${ryanAgent.character.name}`,
  );

  // Start the server
  await app.start();
  // Return the app for further use
  return app;
}

await start();
