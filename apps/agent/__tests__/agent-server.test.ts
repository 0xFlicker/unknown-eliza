import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
  stringToUuid,
  type IAgentRuntime,
} from "@elizaos/core";
import path from "path";
import os from "os";
import fs from "fs";
import alexCharacter from "../src/characters/alex";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { killProcessOnPort } from "./utils/process-utils";
import { TEST_TIMEOUTS } from "./utils/test-timeouts";

describe("AgentServer integration", () => {
  let server: AgentServer;
  let dataDir: string;
  let runtime: IAgentRuntime;
  let testServerPort: number;

  beforeAll(async () => {
    testServerPort = 3100;
    await killProcessOnPort(testServerPort);
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_TIMEOUTS.SHORT_WAIT)
    );
    dataDir = path.join(os.tmpdir(), `eliza-test-${Date.now()}`);
    fs.mkdirSync(dataDir, { recursive: true });
    server = new AgentServer();
    // Start Alex agent with only the SQL plugin to ensure the database adapter is registered
    const testChar = { ...alexCharacter, plugins: ["@elizaos/plugin-sql"] };
    runtime = new AgentRuntime({
      character: testChar,
      plugins: [sqlPlugin],
      settings: { DATABASE_PATH: dataDir, ...process.env },
    });

    await server.initialize({ dataDir });
    await runtime.initialize();

    await server.registerAgent(runtime);
    server.start(testServerPort);
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates message server, channel, and messages", async () => {
    const msgSrv = await server.createServer({
      name: "srv1",
      sourceType: "test",
    });
    expect(msgSrv.name).toBe("srv1");

    const channel = await server.createChannel({
      messageServerId: msgSrv.id,
      name: "room1",
      type: ChannelType.GROUP,
    });
    expect(channel.name).toBe("room1");

    const author = stringToUuid("user1");
    const text = "hello";
    await server.createMessage({
      channelId: channel.id,
      authorId: author,
      content: text,
    });
    const messages = await server.getMessagesForChannel(channel.id);
    expect(messages.some((m) => m.content === text)).toBe(true);
  });

  it("auto-associates multiple agents in the default server", async () => {
    // Register a second agent runtime to the same server
    const otherChar = {
      ...alexCharacter,
      name: "OtherAgent",
      plugins: ["@elizaos/plugin-sql"],
    };
    const runtime2 = new AgentRuntime({
      character: otherChar,
      plugins: [sqlPlugin],
      settings: { PGLITE_PATH: dataDir, ...process.env },
    });
    await runtime2.initialize();
    await server.registerAgent(runtime2);

    const defaultServerId = "00000000-0000-0000-0000-000000000000";
    const agents = await server.getAgentsForServer(defaultServerId);
    expect(agents).toEqual(
      expect.arrayContaining([runtime.agentId, runtime2.agentId])
    );

    const servers1 = await server.getServersForAgent(runtime.agentId);
    const servers2 = await server.getServersForAgent(runtime2.agentId);
    expect(servers1).toContain(defaultServerId);
    expect(servers2).toContain(defaultServerId);
  });

  it("loads the Alex character into the runtime", () => {
    expect(runtime.character.name).toBe(alexCharacter.name);
  });
});
