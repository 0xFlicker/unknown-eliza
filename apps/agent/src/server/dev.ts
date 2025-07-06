import "dotenv/config";
import houseCharacter from "src/characters/house";
import { InfluenceApp } from "./influence-app";
import {
  AgentConfig,
  ChannelConfig,
  ParticipantState,
  ParticipantMode,
  AgentContext,
} from "./types";
import { Character, ChannelType, IAgentRuntime } from "@elizaos/core";
import alexCharacter from "src/characters/alex";
import bethanyCharacter from "src/characters/bethany";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/plugins/socialStrategy";
import { housePlugin } from "../../src/plugins/house";
import { influencerPlugin } from "../../src/plugins/influencer";

/**
 * Example usage of the production-ready agent and channel management system
 * This demonstrates how to properly handle the n² complexity of agent-channel associations
 */
export async function start() {
  // Create the app with configuration
  const app = new InfluenceApp<
    AgentContext,
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
  });

  // Initialize the app
  await app.initialize();

  // Add agents to the system
  console.log("Adding agents...");

  const houseAgent = await app.addAgent({
    character: houseCharacter,
    plugins: [bootstrapPlugin, sqlPlugin as any, openaiPlugin, housePlugin],
    metadata: { role: "host", entityName: "House" },
  });

  const alexAgent = await app.addAgent({
    character: alexCharacter,
    plugins: [
      bootstrapPlugin,
      sqlPlugin as any,
      openaiPlugin,
      influencerPlugin,
    ],
    metadata: { role: "player", entityName: "Alex" },
  });

  const bethanyAgent = await app.addAgent({
    character: bethanyCharacter,
    plugins: [
      bootstrapPlugin,
      sqlPlugin as any,
      openaiPlugin,
      influencerPlugin,
    ],
    metadata: { role: "player", entityName: "Bethany" },
  });

  console.log(
    `Added agents: ${houseAgent.character.name}, ${alexAgent.character.name}, ${bethanyAgent.character.name}`
  );

  // Create a channel with all participants
  console.log("Creating channel...");

  const channelConfig: ChannelConfig = {
    name: "Game Channel",
    type: ChannelType.GROUP,
    participants: [
      {
        agentId: houseAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
      {
        agentId: alexAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
      {
        agentId: bethanyAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
    ],
    metadata: { gameType: "social-strategy" },
  };

  // Start the server
  await app.start();

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const channelId = await app.createChannel(channelConfig);
  console.log(`Created channel: ${channelId}`);

  // Return the app for further use
  return app;
}

await start();
