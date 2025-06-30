# Influence – Full Game Specification

A **light‑weight social‑strategy game** for **AI agents** over a Discord‑like chat interface. Emphasis is on _negotiation, secrecy_ and _asymmetric information_ while keeping the tech stack dead‑simple.

---

## 1 Game Overview

- **Players**: 4–12 AI agents.
- **Goal**: Be the last operative _alive_.
- **Interactions**: Text + optional single image per round.
- **Moderator**: `The House` (bot) enforces phases, records actions, and exposes public info.

---

## 2 Round Flow (Finite‑State Machine)

| State                                 | Alias        | Duration (default) | Allowed Commands                                                           | Exit Condition                                     |
| ------------------------------------- | ------------ | ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `INIT`                                | Waiting Room |  —                 | `!join`, `!start` (host only)                                              | `!start` with ≥ 4 players                          |
| `LOBBY`                               | Public Mixer |  5 min             | free chat in **public game‑channel** \*DMs are **disabled\***              | timer expiry                                       |
| `WHISPER`                             | Phase 1      |  10 min            | `!dm @p`, free chat inside DMs                                             | timer expiry                                       |
| `RUMOR`                               | Phase 2      |  5 min             | exactly one \`!public \<msg/img>\` per player                              | every living player has posted **or** timer expiry |
| `VOTE`                                | Phase 3      |  3 min             | `!empower @p` **and** `!expose @p` (self‑votes disallowed)                 | all ballots in **or** timer expiry                 |
| `POWER`                               | Phase 4      |  2 min             | empowered: `!eliminate @p` **or** `!protect @p` (target must be _exposed_) | action taken **or** timer expiry                   |
| `REVEAL`                              | Phase 5      |  30 s              | —                                                                          | system message sent                                |
| repeat from `LOBBY` → until ≤ 1 alive |              |                    |                                                                            |                                                    |

> **Timeout rule**: If a required command is missing when a timer ends, **The House** auto‑fills a random legal choice to keep play moving.

---

## 3 Detailed Rules

### 3.1 Public Lobby

- During **LOBBY** players may _only_ speak in the public game channel.
- No images in LOBBY to save bandwidth—text only.
- Purpose: let agents establish an initial social read before secret DMs open.

### 3.2 Voting & Ties

- **Empower**: plurality wins; ties → random among tied.
- **Expose**: any vote marks the target _exposed_ (multiple players possible).
- If **no one is exposed**, empowered must _eliminate_ any player _except self_.
- **Protect** clears _exposed_ but gives **no** shield next round.

### 3.3 Elimination

- Eliminated player posts a _last message_ (pre‑registered during VOTE) then is removed from all live channels.
- Their previous DMs remain for narrative continuity but are locked read‑only.

### 3.4 Images

- Limit = 1 PNG/JPEG ≤ 1 MB (512 × 512 default) per player in **RUMOR** phase only.
- Reference with `!public img:<url>`.

### 3.5 Table Stakes

| Parameter         | Default | Range                  |
| ----------------- | ------- | ---------------------- |
| Starting players  |  8      |  4–12                  |
| Phase timers      | see FSM | configurable per lobby |
| Max DM recipients |  4      |  ≥ 2                   |

---

## 4 Backend Data Model (NoSQL‑ish)

```jsonc
// collection‑like pseudo‑schema
Game {
  id, phase, round, timerEndsUtc,
  settings { maxPlayers, timers { lobby, whisper, rumor, vote, power } },
  players: [Player.id],
  history: [GameEvent]
}
Player {
  id, name, status, empoweredRound,
  dmChannels: [Channel.id],
  lastPublicMsgId, role /* future feature */
}
Channel { id, members: [Player.id], messages: [Message.id] }
Message { id, author, content, imageUrl?, ts, channelId }
Vote { round, voter, empowerTarget, exposeTarget }
GameEvent { type, details, ts }
```

> Disk → JSON, RAM → plain JS objects; dump on every state change = trivial durability.

---

## 5 Bot Command Surface

```text
!join                // INIT only
!start               // host begins game (INIT → LOBBY)
!public <text|img:URL>   // in LOBBY (text‑only) & RUMOR (text or image)
!dm @alice @bob      // WHISPER only
!empower @name       // VOTE phase
!expose  @name       // VOTE phase
!eliminate @name     // POWER keeper only
!protect  @name      // POWER keeper only
!status              // DM current public state (any phase)
```

Generally, **The House** will attempt to read intent from agents when waiting for an answer

---

## 6 Moderator Prompt Templates

```text
[INIT]   The House ▸ The waiting room is open—type !join. Minimum 4 agents.
[LOBBY]  Public Mixer begins. Chat here freely for five minutes. DMs are closed.
[WHISPER]  Phase 1. DMs are now enabled—conspire in private.
[RUMOR]  Phase 2. Post exactly one public message or image via !public.
[VOTE]    Phase 3. DM me two commands: !empower X and !expose Y (not yourself).
[POWER]   Phase 4. @EmpoweredAgent, choose: !eliminate Z or !protect Z.
[REVEAL]  Agent Z has been eliminated. Round N ends.
[WIN]     Congratulations, Agent K. You are the last operative.
```

---

## 7 AI‑Agent Prompt Skeleton (per turn)

```yaml
System:
  You are Agent <name> in the game "Influence". The House messages are absolute.
Memory:
  - Your status, allies, debts, and betrayals.
  - Public timeline (truncated).
Task:
  Decide:
    - If LOBBY: craft public opener.
    - If WHISPER: DM actions & recipients.
    - If RUMOR: public message or image.
    - If VOTE: targets.
    - If POWER: eliminate or protect.
Output schema:
  public: "text or img:<url>"
  whisper: [ {to:[names], msg:"..."} ]
  empower: "name"
  expose:  "name"
  powerAction: { type:"eliminate|protect", target:"name" }
```

Handlers translate this structured output to concrete bot commands.

---

## 8 Edge‑Case Logic

1. **AFK Player**: Three consecutive randomised actions → auto‑eliminate (_inactivity_ event).
2. **Zero Empower Votes**: Empowered selected randomly among _alive_ agents.
3. **Only 2 Players Left**:

   - Skip _Expose_; empowered chooses directly.
   - Prevent infinite loops.

---

## 9 Extensions (Out‑of‑scope for MVP)

- **Secret Roles** (e.g., Double‑Agent wins if two specific players survive).
- **House Coin** economy for bribes/immunity auctions.
- **Audience Twists** via emoji polls.
- **Match Replay**: auto‑generated HTML timeline post‑game.

---

## 10 Diary Room

Agents will be capable of reviewing their thoughts and building strategy, saved memories that will form future turns prompts. These periodic evaluations will create content for virtual diary rooms sessions for the agents, where they share their strategy privately with the audience. The house agent as well, while it does not speak often, will always be following along to construct the public facing narrative of the game.

Influencer agents can decide to rethink strategy with their own actions, periodically, or during game transitions. This behavior is implemented with elizaOS actions and evaluators. Actions can be fired off from a single message, where as evaluators run contextually or periodically and receive larger context to work on groups of messages or memories.

---

# ElizaOS v2 Agent Runtime Context & The House Plugin Superguide

This section summarizes key ElizaOS v2 concepts—AgentRuntime, memory & entities, components (actions, providers, evaluators), and the plugin system—from the `.cursor` rules library, and sketches an implementation plan for "The House" Master of Ceremony (MC) agent as an ElizaOS plugin for the Influence game.

## Provider.validate considerations

A provider.validate function is ONLY to be used to check state and verify that a message is of the correct type (e.g. a content.text message) and NEVER to look for keywords. Always use an agentic response to decide which actions to take.

## ElizaOS AgentRuntime Overview

The `AgentRuntime` is the central orchestrator of an ElizaOS v2 agent. It loads character configuration, manages lifecycle events, registers plugins and services, and coordinates message processing and state management.【F:.cursor/rules/elizaos/elizaos_core_runtime.mdc†L10-L12】【F:.cursor/rules/elizaos/elizaos_core_runtime.mdc†L14-L17】

## Memory Management & Knowledge Graph

All memory and state in ElizaOS is accessed via the `IAgentRuntime` API, backed by a pluggable `IDatabaseAdapter`. Developers should never instantiate separate memory managers—use `runtime.createMemory`, `runtime.getMemories`, and `runtime.createEntity` to persist facts, messages, and knowledge-graph entities.【F:.cursor/rules/elizaos/elizaos_core_memory.mdc†L10-L12】【F:.cursor/rules/elizaos/elizaos_core_memory.mdc†L31-L42】【F:.cursor/rules/elizaos/elizaos_core_memory.mdc†L77-L88】

When reading or writing memory, always cast to a known typescript type that extends Memory. NEVER cast a memory or memory.metadata to any to short circuit memory types. Even with casting, a memory may not always be of an expected type. Appropriate use of typeguards ensures that types are correct.

## Core Data Model: Memory, Entity, Room, World

ElizaOS defines first-class types for its data model. A `Memory` represents a single piece of information (usually a message); an `Entity` models an actor or concept; `Room` and `World` model conversational contexts and their containers.【F:.cursor/rules/elizaos/elizaos_types.mdc†L200-L208】【F:.cursor/rules/elizaos/elizaos_types.mdc†L225-L233】【F:.cursor/rules/elizaos/elizaos_types.mdc†L234-L240】

```typescript
interface Memory {
  id?: UUID;
  entityId: UUID;
  roomId: UUID;
  content: Content /* … */;
}
interface Entity {
  id?: UUID;
  names: string[];
  metadata?: Record<string, any>;
  agentId: UUID;
}
interface Room {
  id: UUID;
  source: string;
  type: ChannelType;
  worldId?: UUID;
}
interface World {
  id: UUID;
  agentId: UUID;
  serverId: string;
}
```

## Components: Actions, Providers, Evaluators

Agents are extended through three core component types, registered via plugins. Components must be stateless and interact with the runtime instance for all I/O and state operations.【F:.cursor/rules/elizaos/elizaos_core_components.mdc†L10-L16】

### Action (What the agent can _do_)

````typescript
export interface Action {
  name: string; description: string; examples: ActionExample[][];
  validate(runtime, message, state): Promise<boolean>;
  handler(runtime, message, state): Promise<unknown>;
}
```【F:.cursor/rules/elizaos/elizaos_types.mdc†L149-L155】

### Provider (What the agent *knows*)
```typescript
export interface Provider {
  name: string; description?: string;
  get(runtime, message, state): Promise<{text?:string; data?:any; values?:any}>;
}
```【F:.cursor/rules/elizaos/elizaos_types.mdc†L163-L173】

### Evaluator (How the agent *learns*)
Evaluators run after interactions to analyze or score outcomes.【F:.cursor/rules/elizaos/elizaos_types.mdc†L177-L180】

## Plugin Architecture & Registration Flow

A plugin is a self-contained module that bundles components and services. During `AgentRuntime.initialize()`, plugins are dependency-sorted and their `init()` hook is invoked, registering actions, providers, evaluators, models, services, and routes with the runtime.【F:.cursor/rules/elizaos/elizaos_api_plugins_core.mdc†L10-L18】【F:.cursor/rules/elizaos/elizaos_api_plugins_core.mdc†L21-L30】

```mermaid
graph TD
  subgraph Initialization
    A[initialize()] --> B{Resolve Plugin Dependencies}
    B --> C[registerPlugin(plugin)]
    C --> D[plugin.init(runtime)]
    D --> E{Register Components}
  end
````

## Sketch: "The House" MC Agent Plugin for Influence

Below is a high-level design for a custom ElizaOS plugin that implements The House MC agent. This plugin manages game state, enforces phase transitions, issues prompts, and moderates player commands.

If the there is no folder at apps/agent/src/house/, then this plugin has not yet been implemented! It is likely that webapp and server are still under development. However, all additional information contained here should be aligned with the need to make a functional agent with these specifications.

### Plugin Skeleton

```
apps/agent/src/house/
├── index.ts         # Plugin entry: define and export `housePlugin`
├── actions.ts       # Action handlers for !join, !start, !dm, !public, !empower, !expose, !eliminate, !protect, !status
├── providers.ts     # Providers for current game state and phase prompts
├── types.ts         # Domain types: Game, Player, Vote, Phase, etc.
└── utils.ts         # Helpers: timer scheduling, random selection
```

### Game State Storage

Represent game entities (Game, Player, Vote, GameEvent) as ElizaOS `Entity` and `Memory` records:

- Use `runtime.createEntity()` to upsert `Player` and `Game` entities.
- Use `runtime.createMemory()` to record `GameEvent`s (phase start, actions taken).
- Query with `runtime.getMemories()` or semantic search for history-driven decisions.

### Actions for Phase Enforcement

Define actions conforming to the `Action` interface:

- **JOIN_GAME**: Register a player in the lobby.
- **START_GAME**: Initialize `Game` entity, shuffle seating, transition to WHISPER.
- **WHISPER_PHASE**: Open DMs (channels) to conspirators, schedule next phase.
- **RUMOR_PHASE**: Broadcast public prompt, enforce one public message per player.
- **VOTE_PHASE**: Collect `!empower` and `!expose` votes, tally, resolve ties.
- **POWER_PHASE**: Empowered chooses to eliminate or protect.
- **REVEAL_PHASE**: Announce eliminations, update statuses, loop or end game.

### Providers for LLM Context Composition

Implement providers to assemble game context for The House's prompt to players:

- `GameStateProvider.get()`: Summarizes current phase, round, player statuses.
- `HistoryProvider.get()`: Retrieves last N `GameEvent` memories for context.

Providers supply structured context to ensure reliable LLM-driven moderation.

### Registering the Plugin

```typescript
import { housePlugin } from "./plugin-house";

const runtime = new AgentRuntime({
  character: houseCharacterConfig,
  databaseAdapter: new PGLiteDatabaseAdapter(),
  plugins: [bootstrapPlugin, sqlPlugin, openAIPlugin, housePlugin],
});

await runtime.initialize();
await runtime.start();
```

【F:.cursor/rules/elizaos/elizaos_core_runtime.mdc†L14-L23】

# ElizaOS and Package details

This file contains project-specific configuration and preferences for Claude Code when working with the ElizaOS code.

---

## PROJECT INFORMATION

- **Git Repository:** Yes
- **Main Branch:** `main`
- **Project Type:** TypeScript Monorepo
- **Package Manager:** `bun` (CRITICAL: Never use npm or pnpm)
- **Monorepo Tools:** Turbo, Lerna

---

## MONOREPO ARCHITECTURE

ElizaOS is organized as a monorepo with the following key packages:

### Core Packages

- **`apps/agent`** - Agent character files and actively developed plugins
- **`apps/www`** - Frontend React GUI, modified from elizaos core client

### Plugin Packages

- **`packages/core`** - `@elizaos/core` - The full and complete @elizaos/core, for reference.
- **`packages/plugin-rolodex`** - `@elizaos/plugin-rolodex` - Copy of core eliza olodex plugin, useful examples of relationship building, actions, providers, and evaluators
- **`packages/plugin-social-strategy`** - `@elizaos/plugin-social-strategy` - The old location of ./apps/agent/src/socialStrategy, before it was moved there for agile development w/o package builds. Empty plugin.

## COMMON COMMANDS

### Package Management & Building

```bash
bun install              # Install dependencies
bun run build            # Build w/ tsup
bun run typecheck        # Typecheck w/ tsc
```

### Testing

Check package.json for details, but most packages use vitest and not native bun for testing. Vitest tests must be run using the `run test` script, not the `test` command.

```bash
bun run test
bun run test {path/to/test}
cd apps/agent; bun run test:record # Record new local model responses for test. Necessary if there are prompt changes. See `apps/agent/__tests__/README.md` for details
cd apps/agent; bun run test:record:soft # Record new model evaluations and don't fail on `expectSoft` calls. Useful for running the test to the end to get a full playback, to then adjust chained expectations
cd apps/agent; bun run test:record apps/agent/__tests__/agent-server.test.ts # Record for a single test file
cd apps/agent; bun run test:record apps/agent/__tests__/agent-server.test.ts -t "demonstrates model mocking and automated responses" # Record for a single test case
cd apps/agent; timeout 90 bun test:record __tests__/influence/init-lobby-test.test.ts > debug_output.log 2>&1; echo "Test completed" # Capture all test logs for further analysis
```

When `test:record` is enabled, the tests using `apps/agent/__tests__/utils/recording-test-utils.ts` will not throw, rather they will collect all differences into a report for the console. When `test:record` is not used, these tests will fail. It is up to the developer to look at the diff of the recordings at `apps/agent/recordings` as well as any changes necessary to the test, and make a determination on how the test should be updated and if the test should be re-recorded.

**IMPORTANT**
When making changes to inside `apps/agent/src/*` that have any effect on prompts or model evaluations then any test using `ConversationSimulator` will likely need to be re-recorded.

**IMPORTANT**
Due to `expectSoft` and in order to get a complete model recording, stderr should be checked, for messages about tests that _WILL_ fail when run in playback mode.

DO:

- Start re-recording small, using a test that validates the changes being proposed
- use `test:record` when making changes that effect model evaluation
- use `test` instead of `test:record` when making console.log and other small debug changes
- use tmp files or grep to capture large test outputs

### Development & Running

apps/agent and apps/www can be started in dev or prod mode:

````bash
bun start                # Start in prod mode
bun run dev              # Start with debug logging with rebuild-on-change

### Code Quality

```bash
bun run lint             # Run linting and prettier
bun run format           # Format code with prettier
bun run format:check     # Check formatting without changes
bun run pre-commit       # Run pre-commit linting script

# Package-specific linting/formatting
cd packages/core && bun run lint
cd packages/cli && bun run format
````

---

## CRITICAL RULES

### Package Management

- **NEVER USE `npm` OR `pnpm`**
- **ALWAYS USE `bun` FOR ALL PACKAGE MANAGEMENT AND SCRIPT EXECUTION**
- **IF A COMMAND DOESN'T WORK:** Check `package.json` in the relevant package directory for correct script names
- Use `bun` for global installs: `bun install -g @elizaos/cli`

### Git & GitHub

- **ALWAYS USE `gh` CLI FOR GIT AND GITHUB OPERATIONS**
- Use `gh` commands for creating PRs, issues, releases, etc.
- **WHEN USER PROVIDES GITHUB WORKFLOW RUN LINK:** Use `gh run view <run-id>` and `gh run view <run-id> --log` to get workflow details and failure logs
- **NEVER ADD CO-AUTHOR CREDITS:** Do not include "Co-Authored-By: Claude" or similar co-authoring credits in commit messages or PR descriptions

### Development Branch Strategy

- **Base Branch:** `main`
- **Create PRs against `main` branch**

---

## ARCHITECTURE PATTERNS

### Key Abstractions

- **Channel → Room Mapping:** Discord/Twitter/GUI channels become "rooms"
- **Server → World Mapping:** Servers become "worlds" in agent memory
- **UUID System:** All IDs swizzled with agent's UUID into deterministic UUIDs

### Component Types

- **Actions:** Define agent capabilities and response mechanisms
- **Providers:** Supply dynamic contextual information (agent's "senses")
- **Evaluators:** Post-interaction cognitive processing
- **Tasks:** Manage deferred, scheduled, and interactive operations
- **Services:** Enable AI agents to interact with external platforms
- **Plugins:** Modular extensions for enhanced capabilities

### Database Architecture

- **ORM:** Drizzle ORM with IDatabaseAdapter interface
- **Adapters:** PGLite (local development), PostgreSQL (production)
- **Default:** PGLite for lightweight development

---

## DEVELOPMENT WORKFLOW

### Before Starting Any Task

1. **Understand requirement completely**
2. **Research all affected files and components**
3. **Create detailed implementation plan**
4. **Identify all possible risks and negative outcomes**

### Implementation Process

1. **Write comprehensive tests first when possible**
2. **Implement solution iteratively**
3. **Never use stubs or incomplete code**
4. **Continue until all stubs are replaced with working code**
5. **Test thoroughly - models hallucinate frequently**

### Testing Philosophy

- **Test Framework:** Bun's built-in test runner
- **E2E Tests:** Use actual runtime with real integrations
- **Unit Tests:** Use Bun test with standard primitives
- **Always verify tests pass before declaring changes correct**
- **First attempts are usually incorrect - test thoroughly**

---

## TASK COMPLETION VERIFICATION

### BEFORE CONSIDERING ANY TASK COMPLETE:

1. **CHECK IF ALL RELEVANT TESTS ARE PASSING**
2. **Run package-specific tests** if working on a specific package
3. **Run `bun run test`** in monorepo root to test almost all packages
4. **Run `bun run build`** to ensure code builds successfully
5. **Run `bun run typecheck`** to ensure code type checks successfully
6. **Run `bun run format`** to ensure code formatted successfully
7. **Run `bun run lint`** to check code formatting and style
8. **REFLECT:** Are all tests passing? Did you cut any corners? Are there any build issues?

### Testing Commands by Scope

```bash
# Full test suite (recommended)
bun run test

# Package-specific testing (run from package directory)
cd packages/core && bun test
cd packages/cli && bun test
cd packages/client && bun test

# Run specific test files
bun run test src/path/to/file.test.ts
bun run test --watch                        # Watch mode for development

# Build verification
bun run build
```

---

## CODE STYLE GUIDELINES

### Language & Patterns

- **TypeScript with proper typing for all new code**
- **Use functional programming patterns; avoid classes**
- **Prefer iteration and modularization over code duplication**
- **Comprehensive error handling required**
- **Clear separation of concerns**

### Naming Conventions

- **Variables:** `camelCase` (e.g., `isLoading`, `hasError`)
- **Functions:** `camelCase` (e.g., `searchResults` vs `data`)
- **React Components:** `PascalCase` (e.g., `DashboardMenu`)
- **Props Interfaces:** `PascalCase` ending with `Props` (e.g., `DashboardMenuProps`)
- **File Names:** Match main export (e.g., `DashboardMenu.tsx`, `dashboardLogic.ts`)

### File Organization

- **Follow existing patterns in codebase**
- **Use descriptive variable and function names**
- **Comment complex logic**
- **Don't comment change notes**
- **Never omit code or add "// ..." as it risks breaking the codebase**

---

## ENVIRONMENT CONFIGURATION

### Required Environment Variables

```bash
# Model Provider (at least one required)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Database (optional - defaults to PGLite)
POSTGRES_URL=your_postgres_connection_string

# Logging
LOG_LEVEL=info  # Options: fatal, error, warn, info, debug, trace
```

### Optional Service Keys

```bash
# Discord
DISCORD_APPLICATION_ID=
DISCORD_API_TOKEN=

# Telegram
TELEGRAM_BOT_TOKEN=

# Twitter
TWITTER_TARGET_USERS=
TWITTER_DRY_RUN=false

# Blockchain
EVM_PRIVATE_KEY=
SOLANA_PRIVATE_KEY=
```

---

## IMPORTANT FILES & LOCATIONS

### Configuration Files

- **`package.json`** - Root monorepo configuration
- **`turbo.json`** - Turbo build pipeline configuration
- **`lerna.json`** - Lerna publishing configuration
- **`tsconfig.json`** - TypeScript configuration
- **`.cursorrules`** - Cursor IDE development rules

### Key Source Files

- **`packages/core/src/types/index.ts`** - All core type definitions
- **`packages/core/src/runtime.ts`** - Main runtime implementation
- **`apps/agent/src/agents.ts`** - Core game agents

### Documentation

- **`README.md`** - Main project documentation
- **`AGENTS.md`** - Comprehensive agent documentation (40k+ tokens)
- **`CHANGELOG.md`** - Version history
- **`scripts/dev-instructions.md`** - Developer context and guidance

---

## DEVELOPMENT PRINCIPLES

### Flow - Always Plan First

- **Bug Fixes:** First identify the bug, research ALL related files, create complete change plan
- **Impact Analysis:** Identify all possible errors and negative outcomes from changes
- **Documentation:** Create thorough implementation plan BEFORE writing any code
- **Risk Assessment:** Thoroughly outline all risks and offer multiple approaches

### No Stubs or Incomplete Code

- **Never** use stubs, fake code, or incomplete implementations
- **Always** continue writing until all stubs are replaced with finished, working code
- **No POCs:** Never deliver proof-of-concepts - only finished, detailed code
- **Iteration:** Work on files until they are perfect, testing and fixing until all tests pass

### Test-Driven Development

- Models hallucinate frequently - thorough testing is critical
- Verify tests are complete and passing before declaring changes correct
- First attempts are usually incorrect - test thoroughly
- Write tests before implementation when possible

---

## IMPORTANT NOTES

### Memory System

- Each agent has a fully separate and unique set of UUIDs to describe the same world, rooms, etc
- Uses deterministic UUID generation
- All IDs swizzled with agent's UUID for consistency

### Plugin Architecture

- All components integrate through the runtime
- Services are the state management layer
- Actions drive agent behavior
- Providers supply context
- Evaluators enable learning and reflection
- HTTP routes with "public" exposed as HTML tabs (must have "name" property)

### Compatibility

- Plugin compatibility through `/specs` (currently defaulting to v2)
- Maintain backwards compatibility in changes
- Consider migration paths for proposed changes

---

## TROUBLESHOOTING

### Common Issues

1. **Build Failures:** Check TypeScript errors with `bun run build`
2. **Test Failures:** Run `bun test` and check individual package tests
3. **Import Errors:** Verify correct use of `@elizaos/core` vs `packages/core`
4. **Environment Issues:** Check `.env` file against `.env.example`

### Performance Considerations

- Agent perspective is key for all abstractions
- Services maintain system state
- Access pattern: `getService(serviceName)`
- Services can call each other, actions can access services

### Getting Help

- Check existing documentation in `packages/docs/`
- Review `.cursorrules` for architectural guidance
- Look at existing patterns in similar packages
- Test changes thoroughly before considering complete

---

_This configuration file should be referenced at the start of any ElizaOS development session to ensure proper setup and adherence to project standards._
