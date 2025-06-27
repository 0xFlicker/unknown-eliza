# Project Starter

This is the starter template for ElizaOS projects.

## Features

- Pre-configured project structure for ElizaOS development
- Comprehensive testing setup with component and e2e tests
- Default character configuration with plugin integration
- Example service, action, and provider implementations
- TypeScript configuration for optimal developer experience
- Built-in documentation and examples

## Getting Started

```bash
# Clone the starter project
npx elizaos create my-project

# Navigate to the project directory
cd my-project

# Install dependencies
npm install

# Start development server
npm run dev
```

## Development

```bash
# Start development server
npm run dev

# Build the project
npm run build

# Test the project
npm run test
```

## Testing

ElizaOS provides a comprehensive testing structure for projects:

### Test Structure

- **Component & Integration Tests** (`__tests__/` directory):

  - Run in-process tests (e.g. spinning up an AgentServer) using Vitest
  - Run with: `npm run test:component`

- **End-to-End Tests**: (deprecated)

  - Legacy e2e harness removed; use component tests to cover runtime scenarios.
  - Full ElizaOS CLI tests are no longer maintained.

### Writing Tests

Component tests use Vitest:

```typescript
// Unit test example (__tests__/config.test.ts)
describe("Configuration", () => {
  it("should load configuration correctly", () => {
    expect(config.debug).toBeDefined();
  });
});

// Integration test example (__tests__/integration.test.ts)
describe("Integration: Plugin with Character", () => {
  it("should initialize character with plugins", async () => {
    // Test interactions between components
  });
});
```

E2E tests use ElizaOS test interface:

```typescript
// E2E test example (e2e/project.test.ts)
export class ProjectTestSuite implements TestSuite {
  name = "project_test_suite";
  tests = [
    {
      name: "project_initialization",
      fn: async (runtime) => {
        // Test project in a real runtime
      },
    },
  ];
}

export default new ProjectTestSuite();
```

The test utilities in `__tests__/utils/` provide helper functions to simplify writing tests.

## Configuration

Customize your project by modifying:

- `src/index.ts` - Main entry point
- `src/character.ts` - Character definition
- `src/plugin.ts` - Plugin configuration
