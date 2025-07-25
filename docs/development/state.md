# State Machine Development Plan

> **Status:** Active Development Plan | **Author:** Development Team | **Created:** 2025-01-23

---

## Overview

This document outlines the development plan for integrating XState v5 with ElizaOS IAgentRuntime to create a robust game state machine for the Influence social strategy game. The goal is to build a testable, maintainable state management system that leverages XState's actor model while maintaining ElizaOS's plugin architecture patterns.

## Current State Analysis

### What Exists

- **XState Architecture Doc**: Comprehensive design for game phases and actor hierarchy
- **StateMachineService Stub**: Basic service structure in `apps/agent/src/memory/StateMachineService.ts`
- **Influence App**: Full application framework with agent management in `apps/agent/src/server/influence-app.ts`
- **Game Rules**: Complete specification of game phases (INIT → INTRODUCTION → LOBBY → ...)
- **ElizaOS Integration**: Working runtime, services, and plugin patterns

### What Needs to be Built

- **Core XState Types**: Event definitions, context interfaces, and actor configurations
- **StateMachineService Implementation**: Bridge between XState actors and ElizaOS runtime
- **Game State Persistence**: Integration with ElizaOS memory/entity system
- **Event Coordination**: Cross-agent communication for game state changes
- **Unit Test Suite**: Isolated tests for state machine behavior
- **Integration Tests**: Runtime + state machine working together

## Technical Challenges

### 1. Type Safety Integration

- XState v5 requires strict typing for events, context, and actor communication
- ElizaOS uses UUID-based memory and entity patterns
- Need to bridge these without `as any` or `as unknown` hacks

### 2. Persistence Strategy

- XState actors are ephemeral by default
- ElizaOS persistence is entity/memory-based
- Must maintain deterministic state recovery across runtime restarts

### 3. Event Coordination

- Game events need to coordinate across multiple agent runtimes
- ElizaOS events are per-runtime by default
- Need cross-agent synchronization for game state transitions

### 4. Service Integration

- XState actors must integrate cleanly with ElizaOS Service pattern
- Services should be stateless while actors maintain state
- Clear separation of concerns between persistence and control flow

## Development Phases

### Phase 1: Core Types & Architecture (Current Focus)

**Goal**: Establish the foundational types and patterns for XState + ElizaOS integration

**Tasks**:

1. **Define Core Types** (`apps/agent/src/game/types.ts`)

   - Game phases enum
   - Event type definitions
   - Context interfaces
   - Actor input/output types

2. **Enhance StateMachineService** (`apps/agent/src/memory/StateMachineService.ts`)

   - XState actor management
   - ElizaOS runtime integration
   - Persistence hooks
   - Event bridging

3. **Create Initial Unit Tests**
   - Test XState actor creation and transitions
   - Test ElizaOS memory integration
   - Test event handling without full app context

**Success Criteria**:

- Types compile without any/unknown casts
- Basic state transitions work in isolation
- Persistence to/from ElizaOS memory functions
- Unit tests demonstrate core functionality

### Phase 2: State Machine Implementation

**Goal**: Build the actual game state machines with proper actor hierarchy

**Tasks**:

1. **Implement PhaseMachine** (`apps/agent/src/game/phase.ts`)

   - Top-level phase orchestration
   - Timer management
   - Transition logic

2. **Implement GameplayMachine** (`apps/agent/src/game/gameplay.ts`)

   - Round flow coordination
   - Diary room integration
   - Player readiness tracking

3. **Enhanced Testing**
   - Full phase transition tests
   - Timer and timeout handling
   - Error recovery scenarios

**Success Criteria**:

- Complete INIT → INTRODUCTION → LOBBY flow
- Timer-based transitions work correctly
- State persistence across restarts
- Comprehensive test coverage

### Phase 3: Integration Testing

**Goal**: Prove the state machine works with AgentRuntime in isolated tests

**Tasks**:

1. **Runtime Integration Tests**

   - Create test AgentRuntime instances
   - Test state machine service registration
   - Test cross-agent event coordination

2. **Storage & Eventing Validation**

   - Game state persisted correctly
   - Events propagate between test runtimes
   - Memory queries work as expected

3. **Edge Case Testing**
   - Runtime restart scenarios
   - Network partition simulation
   - Invalid state recovery

**Success Criteria**:

- Multiple AgentRuntime instances coordinate game state
- Persistence survives runtime restarts
- Event system handles edge cases gracefully
- All tests pass consistently

### Phase 4: Influence App Integration (Future)

**Goal**: Integrate the proven state machine into the full Influence application

**Tasks** (pending Phase 3 completion):

1. **Service Registration**: Add StateMachineService to influence-app.ts
2. **House Agent Integration**: Connect state machine to house plugin
3. **Channel Coordination**: Link game states to channel management
4. **End-to-End Testing**: Full application flow with state machine

## Implementation Details

### XState Actor Hierarchy

```
GameMachine (Phase Orchestrator)
├── GameplayMachine (Round Flow)
│   ├── DiaryMachine (AI Reflection Phase)
│   └── ReadyToPlayMachine (Coordination Phase)
└── HouseMachine (MC Agent Integration)
```

### ElizaOS Integration Points

- **Service Registration**: StateMachineService as ElizaOS Service
- **Memory Management**: Game state → Entity/Memory records
- **Event System**: XState events ↔ ElizaOS plugin events
- **Runtime Access**: IAgentRuntime for persistence and communication

### Testing Strategy

**Unit Tests**:

- Individual actor behavior
- Type safety validation
- Memory persistence
- Event handling

**Integration Tests**:

- Multi-runtime coordination
- Full phase transitions
- Error recovery
- Performance validation

**Key Testing Principles**:

- No mocking of core ElizaOS APIs
- Real AgentRuntime instances in tests
- Deterministic test scenarios
- Fast feedback loops

## File Structure

```
apps/agent/src/
├── game/
│   ├── types.ts          # Core type definitions
│   ├── phase.ts          # PhaseMachine implementation
│   ├── gameplay.ts       # GameplayMachine implementation
│   └── __tests__/        # Unit tests for game logic
├── memory/
│   └── StateMachineService.ts # XState + ElizaOS bridge
└── __tests__/
    └── state-machine/    # Integration tests
        ├── runtime-integration.test.ts
        ├── persistence.test.ts
        └── coordination.test.ts
```

## Risk Mitigation

### Type System Complexity

- **Risk**: XState + ElizaOS type integration becomes unwieldy
- **Mitigation**: Start simple, iterate on types, avoid any/unknown

### Performance Concerns

- **Risk**: Actor overhead impacts game responsiveness
- **Mitigation**: Benchmark early, optimize hot paths, limit actor proliferation

### State Synchronization

- **Risk**: Cross-agent state gets out of sync
- **Mitigation**: Event sourcing patterns, deterministic transitions, comprehensive testing

### Testing Complexity

- **Risk**: Integration tests become flaky or slow
- **Mitigation**: Isolated test environments, fast setup/teardown, focused scenarios

## Next Immediate Actions

1. **Create core game types** with proper TypeScript interfaces
2. **Implement basic StateMachineService** with XState actor creation
3. **Write first unit test** demonstrating XState + IAgentRuntime integration
4. **Validate persistence** of game state through ElizaOS memory system
5. **Test event propagation** between test runtime instances

## Success Metrics

- [ ] All types compile without type assertions
- [ ] Unit tests demonstrate core functionality
- [ ] State persists across runtime restarts
- [ ] Events coordinate between multiple runtimes
- [ ] INIT → INTRODUCTION → LOBBY transition works end-to-end
- [ ] Test suite runs fast and reliably
- [ ] Code follows ElizaOS patterns and conventions

---

_This plan will be updated as implementation progresses and new insights are discovered._
