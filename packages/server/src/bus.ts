import { CapacityAwareMessageBus } from "./capacity-aware-bus.js";

/**
 * A message bus for distributing messages from the server
 * to subscribed MessageBusService instances within the same process.
 *
 * Now supports optional channel capacity tracking while maintaining
 * full backward compatibility with the original EventEmitter interface.
 *
 * For multi-process or multi-server deployments, this would need to be replaced
 * with a more robust solution like Redis Pub/Sub, Kafka, RabbitMQ, etc.
 */

const internalMessageBus = new CapacityAwareMessageBus();

// Increase the default max listeners if many agents might be running in one process
internalMessageBus.setMaxListeners(50);

export default internalMessageBus;

// Export the capacity tracker for use by other components
export const getCapacityTracker = () => internalMessageBus.getCapacityTracker();

// Legacy compatibility: also export as simple EventEmitter interface
export { internalMessageBus as InternalMessageBus };
