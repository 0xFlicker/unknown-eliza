# Social Strategy Agent Monorepo

This Bun monorepo contains the following workspaces:

- `apps/agent`: The social-strategy-agent application (package: `@0xflicker/social-strategy-agent`).
- `packages/plugin-social-strategy`: The social strategy plugin (package: `@0xflicker/plugin-social-strategy`).
- `packages/plugin-rolodex`: The Rolodex plugin (package: `@0xflicker/plugin-rolodex`).

Use Bun workspaces and Lerna to manage packages and dependencies.

## Setup

```bash
cd social-strategy-agent
bun install
bun run prepare
```

## Scripts

| Command          | Description                            |
| ---------------- | -------------------------------------- |
| `bun run build`  | Build all packages                     |
| `bun run dev`    | Run development tasks for all packages |
| `bun run start`  | Start all start scripts in packages    |
| `bun run test`   | Run all tests across workspaces        |
| `bun run lint`   | Lint all packages                      |
| `bun run format` | Format all packages                    |
| `bun run format:check` | Check formatting without changes   |

## TypeScript Monorepo + Bun

This repo uses TypeScript path mappings and Bun's native TypeScript support to import package
source files directly (without pre-building). The root `tsconfig.json` contains:

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@elizaos/*": ["packages/*/src"],
      "src/*": ["apps/agent/src/*"]
    }
  }
}
```

With this setup, Bun (and VS Code) will resolve imports like
`import { Foo } from "@elizaos/plugin-social-strategy"`
to `packages/plugin-social-strategy/src/index.ts`, enabling on-the-fly TS transpilation,
single-step debugging across packages, and “go to definition” directly in the `.ts` files.

Run your app from the repo root so Bun picks up the root `tsconfig.json`, e.g.:

```bash
bun run apps/agent/src/server/dev.ts
```

Or add a script in `apps/agent/package.json`:

```jsonc
{
  "scripts": {
    "dev": "bun run --inspect-brk --tsconfig-override ../../tsconfig.json src/server/dev.ts"
  }
}
```
This line has trailing spaces.   
