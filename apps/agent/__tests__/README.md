# Agent Testing Framework

A comprehensive testing framework for ElizaOS agents with support for multi-agent conversations, model evaluation mocking, and social strategy game development.

## Overview

This testing framework provides powerful tools for testing AI agents in complex social scenarios, with particular focus on supporting the development of the **Influence** social strategy game. The framework includes:

- **ConversationSimulator**: Multi-agent conversation testing harness
- **ModelMockingService**: Record/playback system for deterministic model testing
- **Event-driven testing**: Proper ElizaOS integration using bootstrap plugin
- **Structured assertions**: Testable results instead of console-only output

## Quick Start

```bash
# Run all agent tests
bun run test

# Run specific test file
bun run test __tests__/agent-server.test.ts

# Run with model recording (saves actual model responses)
MODEL_RECORD_MODE=true bun run test

# Run with response verification (detects model drift)
MODEL_VERIFY_MODE=true bun run test
```

## Recording Mode Solutions

### Challenge: Assertion Failures During Recording

The main challenge with recording multi-step conversations is that assertion failures prevent complete recording. When expectations fail early in a test, the recording stops, and re-running creates different model responses.

### Solution 1: Soft-Fail Recording Mode (Recommended)

Use `expectSoft()` instead of `expect()` in tests to allow recording to continue even when assertions fail:

```typescript
import { expectSoft, RecordingTestUtils } from "./utils/recording-test-utils";

it("should record complete conversation", async () => {
  RecordingTestUtils.logRecordingStatus("conversation test");
  
  // Soft assertions that won't fail test in record mode
  expectSoft(response).toContain("expected text");
  expectSoft(conversation.length).toBeGreaterThan(5);
  
  // Get suggestions for updating expectations
  RecordingTestUtils.suggestExpectation(
    "response content", 
    actualResponse, 
    "expected content"
  );
}, 120000); // Longer timeout for recording
```

### Solution 2: Recording-First Workflow

1. **Record with soft assertions**: Run tests with `MODEL_RECORD_MODE=true` and soft assertions
2. **Generate expectations**: Use recording data to update test expectations  
3. **Validate with recordings**: Run tests in playback mode with updated expectations
4. **Commit diff review**: Review recording file changes in git

### Solution 3: Expectation Generator

Auto-generate test expectations from recordings:

```typescript
import { RecordingExpectationsGenerator } from "./utils/recording-expectations-generator";

const generator = new RecordingExpectationsGenerator();
generator.generateExpectationsFile("./test-expectations.ts");
```

## Core Components

### 1. ConversationSimulator

**Location**: `__tests__/utils/conversation-simulator.ts`

The main testing harness for creating and managing multi-agent conversations.

#### Basic Usage

```typescript
import { ConversationSimulator } from "./utils/conversation-simulator";

const simulator = new ConversationSimulator({
  agentCount: 3,
  dataDir: "./test-data",
  testContext: {
    suiteName: "My Test Suite",
    testName: "multi-agent conversation",
  },
});

try {
  // Initialize the simulator
  await simulator.initialize();

  // Add agents with plugins
  const agent1 = await simulator.addAgent(
    "Alice",
    { ...baseCharacter, name: "Alice" },
    [bootstrapPlugin, localAIPlugin, socialStrategyPlugin]
  );

  // Send messages and trigger responses
  const { message, responses } = await simulator.sendMessage(
    "Alice",
    "Hello everyone!",
    true // trigger other agents to respond
  );

  // Assert on results
  expect(message.content).toBe("Hello everyone!");
  expect(responses.length).toBeGreaterThan(0);
  expect(responses[0].responded).toBe(true);
} finally {
  await simulator.cleanup();
}
```

#### Configuration Options

```typescript
interface SimulatorConfig {
  /** Number of agents to create */
  agentCount: number;

  /** Legacy model mocking configurations (deprecated) */
  modelMocks?: ModelMockConfig[];

  /** Test data directory */
  dataDir: string;

  /** Server port for testing */
  serverPort?: number;

  /** Enable comprehensive model mocking service (default: true) */
  useModelMockingService?: boolean;

  /** Test context for recording organization */
  testContext?: {
    suiteName: string;
    testName: string;
  };
}
```

#### Key Methods

- **`initialize()`**: Set up test server and channels
- **`addAgent(name, character, plugins)`**: Add an agent to the conversation
- **`sendMessage(fromAgent, content, shouldTriggerResponses)`**: Send a message and optionally trigger other agents
- **`getConversationHistory()`**: Get all messages in chronological order
- **`createConversationSummary()`**: Get statistics about the conversation
- **`cleanup()`**: Clean up resources and save recordings

### 2. ModelMockingService

**Location**: `__tests__/utils/model-mocking-service.ts`

Comprehensive model evaluation mocking system with record, playback, and verification modes.

#### Features

- **Record Mode**: Capture actual model calls to JSON files
- **Playback Mode**: Replay recorded responses for deterministic testing
- **Verify Mode**: Detect response drift by comparing live vs recorded calls
- **Environment Controls**: Use env vars for different modes
- **Organized Storage**: Recordings organized by test suite and name

#### Environment Variables

```bash
# Record actual model responses (expensive but captures real behavior)
MODEL_RECORD_MODE=true bun run test

# Use recorded responses for fast, deterministic tests
# (default mode when recordings exist)

# Verify responses haven't drifted from recordings
MODEL_VERIFY_MODE=true bun run test

# Specify which tests to record (comma-separated patterns)
MODEL_RECORD_TESTS="conversation,strategy" bun run test

# Custom recordings directory
MODEL_RECORDINGS_DIR="./custom-recordings" bun run test
```

#### Recording File Structure

```
recordings/
├── AgentServer_integration__multi_agent_conversation.json
├── SocialStrategy__alliance_formation.json
└── Influence__voting_phase.json
```

#### Recording File Format

```json
{
  "testSuite": "AgentServer integration",
  "testName": "multi-agent conversation",
  "recordings": [
    {
      "id": "agent1-call-1",
      "agentId": "agent1",
      "modelType": "TEXT_SMALL",
      "prompt": "How do you feel about forming an alliance?",
      "options": { "temperature": 0.7 },
      "response": "{\"text\":\"I think trust is important first.\"}",
      "timestamp": "2025-06-27T04:01:34.794Z",
      "testContext": {
        "suiteName": "AgentServer integration",
        "testName": "multi-agent conversation"
      }
    }
  ],
  "metadata": {
    "createdAt": "2025-06-27T04:01:34.794Z",
    "updatedAt": "2025-06-27T04:01:34.794Z",
    "version": "1.0.0"
  }
}
```

#### Manual Usage

```typescript
import { ModelMockingService } from "./utils/model-mocking-service";

const mockingService = new ModelMockingService({
  mode: "record", // or 'playback', 'verify'
  recordingsDir: "./test-recordings",
});

// Set test context for organization
mockingService.setTestContext("My Suite", "my test");

// Patch a runtime to intercept model calls
const cleanup = mockingService.patchRuntime(runtime, "agent1");

// Use the runtime normally - calls will be recorded/mocked
const response = await runtime.useModel(ModelType.TEXT_SMALL, {
  prompt: "Hello world",
});

// Clean up when done
cleanup();
await mockingService.saveRecordings();
```

### 3. Agent Response Testing

The framework provides structured response testing through `AgentResponseResult` objects:

```typescript
interface AgentResponseResult {
  agentName: string;
  responded: boolean; // Did the agent generate a response?
  response?: string; // The actual response text
  modelCalls: number; // Number of model calls made
  error?: string; // Any error that occurred
}
```

#### Example Test

```typescript
it("should test agent responses", async () => {
  const { message, responses } = await simulator.sendMessage(
    "Agent1",
    "What's our strategy?",
    true // trigger responses
  );

  // Test message was created
  expect(message.content).toBe("What's our strategy?");
  expect(message.authorName).toBe("Agent1");

  // Test other agents responded
  const agent2Response = responses.find((r) => r.agentName === "Agent2");
  expect(agent2Response?.responded).toBe(true);
  expect(agent2Response?.response).toContain("strategy");
  expect(agent2Response?.modelCalls).toBeGreaterThan(0);
  expect(agent2Response?.error).toBeUndefined();
});
```

## Testing Patterns

### 1. Basic Agent Functionality

```typescript
it("should process actions correctly", async () => {
  const runtime = new AgentRuntime({
    character: testCharacter,
    plugins: [bootstrapPlugin, localAIPlugin],
  });

  await runtime.initialize();

  const memory = createTestMemory("Hello!");
  const state = await runtime.composeState(memory);

  // Test action processing
  for (const action of runtime.actions) {
    const isValid = await action.validate(runtime, memory, state);
    if (isValid) {
      const mockCallback = vi.fn();
      await action.handler(runtime, memory, state, mockCallback);
      expect(mockCallback).toHaveBeenCalled();
      break;
    }
  }
});
```

### 2. Multi-Agent Conversations

```typescript
it("should handle multi-agent discussions", async () => {
  const simulator = new ConversationSimulator({
    agentCount: 3,
    dataDir: testDataDir,
    testContext: { suiteName: "Multi-Agent", testName: "discussion" },
  });

  await simulator.initialize();

  // Add agents with different personalities
  await simulator.addAgent("Diplomat", diplomatCharacter, plugins);
  await simulator.addAgent("Strategist", strategistCharacter, plugins);
  await simulator.addAgent("Analyzer", analyzerCharacter, plugins);

  // Start a discussion
  const { responses } = await simulator.sendMessage(
    "Diplomat",
    "We need to discuss our alliance strategy.",
    true
  );

  // Verify multiple agents participated
  expect(responses.filter((r) => r.responded)).toHaveLength(2);

  // Check conversation flow
  const history = simulator.getConversationHistory();
  expect(history.length).toBeGreaterThan(1);

  // Analyze conversation patterns
  const summary = simulator.createConversationSummary();
  expect(summary.participantCount).toBe(3);
  expect(summary.messagesByAgent["Diplomat"]).toBeGreaterThan(0);
});
```

### 3. Social Strategy Testing

```typescript
it("should test alliance formation behavior", async () => {
  const simulator = new ConversationSimulator({
    agentCount: 4,
    dataDir: testDataDir,
    testContext: {
      suiteName: "SocialStrategy",
      testName: "alliance formation",
    },
  });

  await simulator.initialize();

  // Add agents with social strategy plugin
  for (let i = 1; i <= 4; i++) {
    await simulator.addAgent(
      `Player${i}`,
      { ...baseCharacter, name: `Player${i}` },
      [bootstrapPlugin, localAIPlugin, socialStrategyPlugin]
    );
  }

  // Initiate alliance discussion
  const { responses } = await simulator.sendMessage(
    "Player1",
    "I think we should form an alliance. Who's interested?",
    true
  );

  // Analyze responses for alliance-related keywords
  const allianceResponses = responses.filter(
    (r) =>
      r.response?.toLowerCase().includes("alliance") ||
      r.response?.toLowerCase().includes("trust") ||
      r.response?.toLowerCase().includes("together")
  );

  expect(allianceResponses.length).toBeGreaterThan(0);
});
```

### 4. Model Response Consistency

```typescript
it("should maintain consistent responses", async () => {
  // First run: record responses
  process.env.MODEL_RECORD_MODE = "true";

  const simulator1 = new ConversationSimulator({
    agentCount: 2,
    dataDir: testDataDir,
    testContext: { suiteName: "Consistency", testName: "response check" },
  });

  await simulator1.initialize();
  // ... set up agents and run conversation
  await simulator1.cleanup();

  // Second run: verify consistency
  delete process.env.MODEL_RECORD_MODE;
  process.env.MODEL_VERIFY_MODE = "true";

  const simulator2 = new ConversationSimulator({
    agentCount: 2,
    dataDir: testDataDir,
    testContext: { suiteName: "Consistency", testName: "response check" },
  });

  // Should use recorded responses and detect any drift
  await simulator2.initialize();
  // ... run same conversation
  await simulator2.cleanup();
});
```

## Best Practices

### 1. Test Organization

- Use descriptive test context names for recording organization
- Group related tests in the same suite
- Use separate data directories for different test scenarios

### 2. Model Mocking Strategy

- **Development**: Use legacy mocking with predefined responses for fast iteration
- **CI/Integration**: Use playback mode with recorded responses for deterministic tests
- **Validation**: Use record mode periodically to capture new behaviors
- **Regression**: Use verify mode to detect unintended changes

### 3. Recording Mode Workflow

**Step 1: Initial Recording**
```bash
# Run tests with recording and soft assertions
MODEL_RECORD_MODE=true bun run test --timeout=120000
```

**Step 2: Update Expectations**
```typescript
// Review console output for suggested expectations:
// 🔧 [RECORD MODE] Suggestion for response content:
//    expect(...).toBe("actual response") // was: "expected response"

// Or generate expectations file:
import { RecordingExpectationsGenerator } from "./utils/recording-expectations-generator";
const generator = new RecordingExpectationsGenerator();
generator.generateExpectationsFile();
```

**Step 3: Validate Recordings**
```bash
# Run tests in playback mode with updated expectations
bun run test
```

**Step 4: Commit Review**
- Review changes in `recordings/*.json` files
- Verify expectations match intended behavior
- Commit both test updates and recording files

### 4. Cleanup and Resource Management

Always use try/finally blocks to ensure cleanup:

```typescript
const simulator = new ConversationSimulator(config);
try {
  await simulator.initialize();
  // ... test logic
} finally {
  await simulator.cleanup(); // Essential for resource cleanup
}
```

### 4. Timeout Handling

Local AI models can take time to start up:

```typescript
it("should handle long conversations", async () => {
  // ... test logic
}, 90000); // 90 second timeout for local AI startup
```

### 5. Error Handling

Check for errors in agent responses:

```typescript
const { responses } = await simulator.sendMessage("Agent1", "Hello", true);

for (const response of responses) {
  if (response.error) {
    console.warn(`Agent ${response.agentName} error:`, response.error);
  }
  expect(response.error).toBeUndefined();
}
```

## Debugging

### 1. Enable Verbose Logging

```bash
LOG_LEVEL=debug bun run test
```

### 2. Inspect Conversation History

```typescript
const history = simulator.getConversationHistory();
console.log(
  "Conversation flow:",
  history.map((m) => `${m.authorName}: ${m.content}`)
);
```

### 3. Check Model Call Statistics

```typescript
const mockingService = simulator.getModelMockingService();
const stats = mockingService?.getResponseStats();
console.log("Model calls:", stats);
```

### 4. Save Conversations for Analysis

```typescript
await simulator.saveConversation("./debug-conversation.json");
```

## Advanced Usage

### Custom Character Creation

```typescript
const customCharacter = {
  name: "StrategicAgent",
  bio: "An agent focused on strategic thinking and alliance formation",
  lore: "Trained in game theory and social dynamics",
  messageExamples: [
    {
      name: "StrategicAgent",
      content: {
        text: "I believe we should analyze the risks before committing to any alliance.",
      },
    },
  ],
  postExamples: [],
  adjectives: ["strategic", "analytical", "cautious"],
  people: [],
  topics: ["strategy", "alliances", "risk assessment"],
  style: {
    all: ["Think strategically", "Consider long-term consequences"],
    chat: ["Be diplomatic but firm"],
    post: ["Provide clear reasoning"],
  },
};
```

### Plugin Integration

```typescript
import { socialStrategyPlugin } from "../src/socialStrategy";
import { customGamePlugin } from "./utils/custom-game-plugin";

const plugins = [
  bootstrapPlugin, // Core ElizaOS functionality
  localAIPlugin, // Local model support
  socialStrategyPlugin, // Social dynamics tracking
  customGamePlugin, // Game-specific logic
];

const agent = await simulator.addAgent("GameMaster", character, plugins);
```

### Event-Driven Testing

```typescript
// Listen for specific events during testing
runtime.on(EventType.MESSAGE_RECEIVED, async (payload) => {
  console.log("Message received:", payload.message.content.text);
});

runtime.on(EventType.RUN_STARTED, async (payload) => {
  console.log("Agent started processing");
});

runtime.on(EventType.RUN_ENDED, async (payload) => {
  console.log("Agent finished processing");
});
```

## Influence Game Integration

This framework is specifically designed to support testing of the **Influence** social strategy game. Key testing scenarios include:

### 1. Phase Testing

```typescript
it("should handle voting phase correctly", async () => {
  // Test voting mechanics, alliance formation, betrayal detection
});

it("should manage whisper phase interactions", async () => {
  // Test private messaging, secret alliances, information sharing
});
```

### 2. Game Mechanics Testing

```typescript
it("should detect betrayal attempts", async () => {
  // Test social context analysis and relationship tracking
});

it("should form strategic alliances", async () => {
  // Test multi-agent cooperation and trust building
});
```

### 3. The House (Game Master) Testing

```typescript
it("should moderate game phases correctly", async () => {
  // Test phase transitions, rule enforcement, timeout handling
});
```

## Troubleshooting

### Common Issues

1. **"Cannot find module '@elizaos/core'"**

   - Run `bun install` in the root directory
   - Ensure packages are built: `bun run build`

2. **"No room found" errors**

   - Ensure agents are properly registered with the server
   - Check that rooms are created before sending messages

3. **"callback is not a function" errors**

   - Action handlers require a callback parameter
   - Use `vi.fn()` for mock callbacks in tests

4. **Database foreign key constraint errors**

   - Ensure rooms are properly set up before creating memories
   - Call `runtime.ensureRoomExists()` for each agent

5. **Model timeout errors**
   - Increase test timeouts for local AI startup (90s recommended)
   - Use model mocking for faster test execution

### Performance Tips

- Use model mocking for faster test execution
- Run tests in parallel when possible
- Clean up resources properly to prevent memory leaks
- Use separate data directories for parallel tests

## Contributing

When adding new tests:

1. Follow the established patterns for simulator usage
2. Add appropriate test context for recording organization
3. Include both positive and negative test cases
4. Document any new testing utilities
5. Update this README with new patterns or features

## File Structure

```
__tests__/
├── README.md                                    # This documentation
├── agent-server.test.ts                        # Main integration tests
├── utils/
│   ├── conversation-simulator.ts               # Multi-agent testing harness
│   ├── model-mocking-service.ts                # Model evaluation mocking
│   ├── recording-test-utils.ts                 # Soft assertions for recording mode
│   ├── recording-expectations-generator.ts     # Generate expectations from recordings
│   ├── process-utils.ts                        # Process management utilities
│   └── test-timeouts.ts                        # Timeout constants
└── recordings/                                 # Model response recordings
    ├── AgentServer_integration__*.json
    └── SocialStrategy__*.json
```

This framework provides a solid foundation for testing complex AI agent interactions and social strategy behaviors. Use it to build confidence in your agent implementations and ensure consistent behavior across different scenarios.
