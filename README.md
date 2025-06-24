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
