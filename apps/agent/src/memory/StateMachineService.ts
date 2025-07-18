import { createActor } from "xstate";
import { IAgentRuntime, Service, UUID } from "@elizaos/core";
import { GameState } from "./types";
import { createPhaseMachine } from "./state/phase";
import { getGameState } from "./runtime";

function createStateMachineService(
  runtime: IAgentRuntime,
  initialContext: GameState,
) {
  const phaseMachine = createPhaseMachine(initialContext);
  const phaseActor = createActor(phaseMachine);
  phaseActor.start();
  return phaseActor;
}

export class StateMachineService extends Service {
  public static readonly serviceName = "StateMachineService";

  capabilityDescription = "Game service";

  private promisePhaseActor?: Promise<
    ReturnType<typeof createStateMachineService>
  >;
  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  async initialize({
    initialContext,
    roomId,
  }: {
    initialContext?: GameState;
    roomId: UUID;
  }) {
    this.promisePhaseActor = initialContext
      ? Promise.resolve(createStateMachineService(this.runtime, initialContext))
      : getGameState(this.runtime, roomId).then((gameState) => {
          if (!gameState) {
            throw new Error("Game state not found");
          }
          return createStateMachineService(this.runtime, gameState);
        });
  }

  public static async start(runtime: IAgentRuntime) {
    const service = new StateMachineService(runtime);
    return service;
  }

  async stop() {
    if (this.promisePhaseActor) {
      const phaseActor = await this.promisePhaseActor;
      phaseActor.stop();
    }
  }
}
