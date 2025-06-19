# Plugin: @0xflicker/plugin-social-strategy

Tracks and manages player relationships and trust scores for social strategy analysis.

## Installation

```bash
bun add @0xflicker/plugin-social-strategy
```

## Usage

Import the plugin and include it in your agent configuration:

```ts
import { socialStrategyPlugin } from '@0xflicker/plugin-social-strategy';

const projectAgent = {
  plugins: [socialStrategyPlugin],
  // ...
};
```