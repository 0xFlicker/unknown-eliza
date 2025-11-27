import { IAgentRuntime, Service, UUID } from "@elizaos/core";

export class StateMachineService extends Service {
  public static readonly serviceName = "StateMachineService";

  capabilityDescription = "Game service";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: IAgentRuntime) {
    const service = new StateMachineService(runtime);
    return service;
  }

  async stop() {}
}
