# Writing code for the social strategy game "Influence"

Emit idiomatic Typescript ElizaOS code.

Hacks or exceptions to these rules MUST be documented in the code, for future readers.

# ElizaOS design patterns

ElizaOS plugins extend agent capabilities through four main component types. All components must be stateless and interact with
the runtime instance for all I/O and state operations.

## Actions - What the Agent Can Do

Actions define specific capabilities an agent can perform in response to messages. They are the agent's behavioral repertoire.

Interface Definition

```
export interface Action {
  name: string;
  description: string;
  examples: ActionExample[][];
  validate(runtime: IAgentRuntime, message: Message, state?: State): Promise<boolean>;
  handler(runtime: IAgentRuntime, message: Message, state?: State): Promise<unknown>;
}
```

Key Principles

- Actions can ONLY be picked by agents in RESPONSE to messages - they cannot be used for automatic/periodic behavior
- The validate method should check message compatibility and state, but never perform text-based keyword validation
- Always use agentic responses to decide which actions to take and NEVER keyword matching

Example from our implementation:

```
export const iAmReadyAction: Action = {
  name: "I_AM_READY",
  description: "Signal readiness for phase transitions in the Influence game",
  examples: [
    [
      { user: "{{user1}}", content: { text: "I'm ready for the next phase" } },
      { user: "{{agentName}}", content: { text: "I acknowledge your readiness", action: "I_AM_READY" } }
    ]
  ],
  validate: async (runtime: IAgentRuntime, message: Message) => {
    // Only validate message type and state, not keywords
    return message.content?.text && typeof message.content.text === "string";
  },
  handler: async (runtime: IAgentRuntime, message: Message) => {
    // Implementation that emits readiness event
    await runtime.emitEvent(GameEventType.I_AM_READY, payload);
  }
};
```

## Providers - What the Agent Knows

Providers supply dynamic contextual information to agents during message processing. They act as the agent's "senses."

Interface Definition

```
export interface Provider {
  name: string;
  description?: string;
  get(runtime: IAgentRuntime, message: Message, state?: State): Promise<{
    text?: string;
    data?: any;
    values?: any;
  }>;
}
```

Example from our implementation:

```
export const gameStateProvider: Provider = {
  name: "game-state",
  description: "Provides current game state information for strategic decision making",
  get: async (runtime: IAgentRuntime, message: Message, state?: State) => {
    const roomId = message.roomId;
    const gameState = await getGameState(runtime, roomId);

    return {
      text: `Current game phase: ${gameState?.phase}, Round: ${gameState?.round}`,
      data: gameState,
      values: {
        currentPhase: gameState?.phase,
        round: gameState?.round,
        playerCount: gameState?.players?.size || 0
      }
    };
  }
};
```

# Evaluators - How the Agent Learns

Evaluators run after interactions to analyze outcomes, update memory, or trigger follow-up actions. They enable learning and
reflection.

Interface Definition

```
export interface Evaluator {
  name: string;
  description?: string;
  validate(runtime: IAgentRuntime, message: Message, state?: State): Promise<boolean>;
  handler(runtime: IAgentRuntime, message: Message, state?: State): Promise<void>;
  // Additional properties for scheduling and conditions
}
```

Key Notes

- They are used for post-interaction cognitive processing
- Can be triggered by message patterns, time intervals, or other conditions

# Events - Cross-agent eventing

In ElizaOS, event handlers are defined at the _plugin_ level via the `PluginEvents` plugin value. It is important to remember that events are on a _per-runtime basis_. Events that need to cross agent boundaries should use @src/house/events/manager.ts, which uses a special chat channel to pass messages. Game state events can be used to introduce hard synchronization between agents that for game reasons shouldn't be left to agentic decision.

Plugin event handler emitting another event example:

```
  events: {
    [GameEventType.PHASE_STARTED]: [
      async ({ message, runtime }) => {
        const phase = message.payload.phase;
        if (phase === Phase.INIT) {
          const coordinationService = runtime.getService(
            CoordinationService.serviceType
          ) as CoordinationService;
          if (!coordinationService) {
            logger.warn(
              "CoordinationService not available for introduction response"
            );
            return;
          }

          await coordinationService.sendGameEvent(GameEventType.I_AM_READY, {
            runtime,
            gameId: message.payload.gameId,
            roomId: message.payload.roomId,
            playerId: runtime.agentId,
            playerName: runtime.character?.name || "Unknown Player",
            readyType: "phase_action",
            targetPhase: Phase.LOBBY,
            timestamp: Date.now(),
            source: "influencer-plugin",
          });
        }
      },
    ],
  } as unknown as PluginEvents & GameEventHandlers, // NOTE: intentional overload of available events, specific to this package
```

Key points:

- `PluginEvents` supported on the plugin interface is a known set of events with everything Strongly typed.
- `as unknown as PluginEvents & GameEventHandlers` is unfortunately required in order to extend PluginEvents on the plugin interface
- Events are used

# Services - State Management Layer

Services provide shared functionality and state management across plugin components. They follow the ElizaOS service pattern.

Interface Pattern

```
export class MyService extends Service {
  static serviceType = "my-service";
  capabilityDescription = "Description of what this service provides";

  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Service initialization
  }

  static async start(runtime: IAgentRuntime): Promise<MyService> {
    const service = new MyService(runtime);
    await service.initialize(runtime);
    runtime.registerService(MyService);
    return service;
  }

  async stop(): Promise<void> {
    // Cleanup
  }
}
```

Example from our implementation:

```
export class CoordinationService extends Service {
  static serviceType = "coordination";

  async sendGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    payload: GameEventPayloadMap[T]
  ): Promise<void> {
    const message = createGameEventMessage(
      this.runtime.agentId,
      eventType,
      payload,
      "others"
    );
    // Send via existing message handlers
  }
}
```

## Plugin Registration

Components are registered during plugin initialization:

```
export const myPlugin: Plugin = {
  name: "my-plugin",
  description: "Plugin description",
  actions: [myAction1, myAction2],
  providers: [myProvider1, myProvider2],
  evaluators: [myEvaluator1],
  services: [MyService],
  events: {
    [EventType.MESSAGE_RECEIVED]: [
      messageHandler
    ],
    [GameEventType.PHASE_STARTED]: [
      gameStartHandler
    ]
  }

  async init(runtime: IAgentRuntime): Promise<void> {
    // Plugin-specific initialization
    // Services are automatically registered
    // Actions, providers, evaluators are automatically registered
  }
};
```
