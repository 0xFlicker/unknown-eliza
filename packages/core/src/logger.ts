import winston from "winston";
import { Sentry } from "./sentry/instrument";
import { StreamTransportOptions } from "winston/lib/winston/transports";

// Local utility function to avoid circular dependency
function parseBooleanFromText(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

/**
 * Interface representing a log entry.
 * @property {number} [time] - The timestamp of the log entry.
 * @property {unknown} [key] - Additional properties that can be added to the log entry.
 */
interface LogEntry {
  time?: number;
  [key: string]: unknown;
}

/**
 * Custom winston transport that maintains recent logs in memory.
 * This transport filters service/agent logs and provides access to recent logs.
 */
class InMemoryTransport extends winston.transports.Stream {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs
  private prettyTransport: typeof winston.transports.Stream | null = null;

  constructor(options: StreamTransportOptions = { stream: process.stdout }) {
    super(options);
    (this as any).name = "in-memory";
  }

  /**
   * Sets the pretty transport for console output
   * @param {winston.transports.Stream} transport - The winston transport for pretty output
   */
  setPrettyTransport(transport: typeof winston.transports.Stream): void {
    this.prettyTransport = transport;
  }

  /**
   * Log method required by winston Transport interface
   * @param {any} info - The log info object
   * @param {Function} callback - The callback function
   */
  log(info: any, callback?: () => void): void {
    const logEntry: LogEntry = {
      time: Date.now(),
      level: info.level,
      message: info.message,
      ...info,
    };

    // Filter out service registration logs unless in debug mode
    const isDebugMode =
      (process?.env?.LOG_LEVEL || "").toLowerCase() === "debug";
    const isLoggingDiagnostic = Boolean(process?.env?.LOG_DIAGNOSTIC);

    if (isLoggingDiagnostic) {
      // When diagnostic mode is on, add a marker to every log to see what's being processed
      logEntry.diagnostic = true;
    }

    if (!isDebugMode) {
      // Check if this is a service or agent log that we want to filter
      if (logEntry.agentName && logEntry.agentId) {
        const msg = info.message || "";
        // Filter only service/agent registration logs, not all agent logs
        if (
          typeof msg === "string" &&
          (msg.includes("registered successfully") ||
            msg.includes("Registering") ||
            msg.includes("Success:") ||
            msg.includes("linked to") ||
            msg.includes("Started"))
        ) {
          if (isLoggingDiagnostic) {
            console.error("Filtered log:", JSON.stringify(logEntry));
          }
          // This is a service registration/agent log, skip it
          if (callback) callback();
          return;
        }
      }
    }

    // Add to memory buffer
    this.logs.push(logEntry);

    // Maintain buffer size
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Forward to pretty transport if available
    if (this.prettyTransport) {
      this.prettyTransport.log(info, callback);
    } else if (callback) {
      callback();
    }
  }

  /**
   * Retrieves the recent logs from memory.
   * @returns {LogEntry[]} An array of LogEntry objects representing the recent logs.
   */
  recentLogs(): LogEntry[] {
    return this.logs;
  }

  /**
   * Clears all logs from memory.
   */
  clear(): void {
    this.logs = [];
  }
}

// Define custom levels matching pino levels
const customLevels = {
  colors: {
    fatal: "red",
    error: "red",
    warn: "yellow",
    info: "blue",
    progress: "cyan",
    success: "brightGreen",
    debug: "magenta",
    trace: "grey",
  },
};

// Add custom levels to winston
winston.addColors(customLevels.colors);

// const raw = parseBooleanFromText(process?.env?.LOG_JSON_FORMAT) || false;

// Set default log level to info to allow regular logs, but still filter service logs
const isDebugMode = (process?.env?.LOG_LEVEL || "").toLowerCase() === "debug";
const effectiveLogLevel = isDebugMode
  ? "debug"
  : process?.env?.DEFAULT_LOG_LEVEL || "info";

/**
 * Creates a winston format for pretty printing logs with custom colors and formatting.
 * @returns {winston.Format} The winston format for pretty printing
 */
const createPrettyFormat = () => {
  return winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const cleanMessage =
        typeof message === "string"
          ? message.replace(/ERROR \([^)]+\):/g, "ERROR:")
          : message;

      // Include metadata if present
      const metaString =
        Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

      return `${timestamp} ${level}: ${cleanMessage}${metaString}`;
    })
  );
};

/**
 * Creates a winston format for JSON output.
 * @returns {winston.Format} The winston format for JSON output
 */
const createJSONFormat = () => {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );
};

// Create the in-memory transport
const inMemoryTransport = new InMemoryTransport();

// Create winston logger with custom levels and transports
const createWinstonLogger = (bindings: any | boolean = false) => {
  const transports: winston.transport[] = [
    inMemoryTransport,
    new winston.transports.Console({
      format: createPrettyFormat(),
    }),
  ];

  // Add console transport if not in raw mode
  // if (!raw) {
  //   const consoleTransport = new winston.transports.Console({
  //     format: createPrettyFormat(),
  //   });
  //   transports.push(consoleTransport);
  //   inMemoryTransport.setPrettyTransport(consoleTransport);
  // } else {
  //   const jsonTransport = new winston.transports.Console({
  //     format: createJSONFormat(),
  //   });
  //   transports.push(jsonTransport);
  //   inMemoryTransport.setPrettyTransport(jsonTransport);
  // }

  const logger = winston.createLogger({
    level: effectiveLogLevel,
    transports,
    defaultMeta: bindings || {},
  });

  // // Add Sentry integration and error formatting
  const originalLog = logger.log.bind(logger);
  logger.log = (level: any, message?: any, meta?: any) => {
    // Handle Sentry logging
    if (process.env.SENTRY_LOGGING !== "false") {
      if (message instanceof Error) {
        Sentry.captureException(message);
      } else if (meta instanceof Error) {
        Sentry.captureException(meta);
      }
    }

    // Format errors
    const formatError = (err: Error) => ({
      message: `(${err.name}) ${err.message}`,
      stack: err.stack?.split("\n").map((line) => line.trim()),
    });

    // Handle different argument patterns
    if (typeof level === "object" && level.level) {
      // If level is actually a log object
      return originalLog(level);
    }

    if (message instanceof Error) {
      return originalLog(level, message.message, {
        error: formatError(message),
        ...meta,
      });
    }

    if (meta instanceof Error) {
      return originalLog(level, message, {
        error: formatError(meta),
      });
    }

    return originalLog(level, message, meta);
  };

  return logger;
};

// Add type for logger with clear method
interface LoggerWithClear extends winston.Logger {}

// Create the main logger
const logger = createWinstonLogger() as LoggerWithClear;

// Add clear method to logger
logger.clear = () => {
  inMemoryTransport.clear();
  return logger;
};

/**
 * Creates a logger instance with optional bindings.
 * @param {any | boolean} bindings - Optional bindings to add to all log messages
 * @returns {winston.Logger} A winston logger instance
 */
const createLogger = (bindings: any | boolean = false) => {
  return createWinstonLogger(bindings);
};

export { createLogger, logger };

// for backward compatibility
export const elizaLogger = logger;

export default logger;
