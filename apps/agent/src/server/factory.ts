import fs from "fs";
import path from "path";
import os from "os";
import { Character, IAgentRuntime, UUID } from "@elizaos/core";
import dotenv from "dotenv";
import { AgentServer, internalMessageBus } from "@elizaos/server";
import { Subject, Observable } from "rxjs";
import { Phase, GameSettings } from "../plugins/house/types";
import { AppServerConfig } from "./types";
import { isPortOpen } from "../safeUtils";

export async function createAgentServer<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
>(config: AppServerConfig<Context, Runtime>) {
  const { runtimeConfig } = config;
  let { serverPort } = config;
  // Check if the port is open
  if (!serverPort) {
    let yes: boolean;
    let attempts = 0;
    let offset = Math.floor(Math.random() * 100);
    do {
      yes = await isPortOpen({
        host: "localhost",
        port: 3000 + offset + attempts,
        timeout: 75,
      });
    } while (!yes && attempts++ < 10);
    if (yes) {
      serverPort = 3000 + offset + attempts;
    }
  }

  if (!serverPort) {
    throw new Error("Please provide an available server port");
  }

  let { dataDir } = config;

  if (!dataDir) {
    // temporary directory
    dataDir = path.join(os.tmpdir(), "elizaos-agent-server");
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const agentServer = new AgentServer();
  await agentServer.initialize({ dataDir });

  const server = await agentServer.createServer({
    name: "Influence",
    sourceType: "App",
    metadata: {
      ...config.context,
    },
  });

  return {
    server,
    agentServer,
    dataDir,
    serverPort,
  };
}
