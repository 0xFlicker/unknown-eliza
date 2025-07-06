import { createUniqueUuid, IAgentRuntime } from "@elizaos/core";
import { AgentServer, internalMessageBus } from "@elizaos/server";
import { AppServerConfig, RuntimeDecorator } from "./types";
import EventEmitter from "node:events";
import { createAgentServer } from "./factory";

export class InfluenceApp<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private server: AgentServer;
  private serverMetadata: Context;
  private serverPort: number;
  private bus: EventEmitter;
  private runtimes: Map<string, Runtime> = new Map();
  private channels: Map<string, MessageChannel> = new Map();

  private defaultRuntimeDecorators: RuntimeDecorator<Runtime>[] = [];

  constructor(private config: AppServerConfig<Context, Runtime>) {
    this.bus = internalMessageBus;
    if (config.runtimeConfig?.runtime) {
      this.defaultRuntimeDecorators.push(config.runtimeConfig?.runtime);
    }
    for (const plugin of config.runtimeConfig?.defaultPlugins || []) {
      this.defaultRuntimeDecorators.push((runtime) => {
        runtime.registerPlugin(plugin);
        return runtime as Runtime;
      });
    }
  }

  async initialize() {
    const { server, agentServer, serverPort } = await createAgentServer(
      this.config
    );
    this.server = agentServer;
    this.serverMetadata = server.metadata as Context;
    this.serverPort = serverPort;
  }

  async start() {
    this.server.start(this.serverPort);
  }

  async stop() {
    await this.server.stop();
  }
}
