import { socialStrategyPlugin } from "./socialStrategy/index";
export { trackConversation } from "./socialStrategy/actions/trackConversation";
export * from "./types";

// Default export for runtime plugin loading
export default socialStrategyPlugin;
