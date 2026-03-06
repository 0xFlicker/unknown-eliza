// Augment pino's LogFn to accept (string, ...args: any[]) patterns
// used throughout the codebase. Pino's default overloads are too strict
// for the logging patterns in elizaos.
declare module "pino" {
  interface LogFn {
    (msg: string, ...args: any[]): void;
    (obj: object, msg?: string, ...args: any[]): void;
  }
}
