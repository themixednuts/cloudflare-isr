import type { Logger } from "./types.ts";

function formatLogArgs(logger: Logger | undefined, args: unknown[]): unknown[] {
  const prefix = logger?.prefix ?? "[ISR]";
  if (args.length === 0) return [prefix];
  const [first, ...rest] = args;
  return typeof first === "string" ? [`${prefix} ${first}`, ...rest] : [prefix, first, ...rest];
}

export function logDebug(logger: Logger | undefined, ...args: unknown[]): void {
  if (!logger?.debug) return;
  logger.debug(...formatLogArgs(logger, args));
}

export function logInfo(logger: Logger | undefined, ...args: unknown[]): void {
  if (!logger?.info) return;
  logger.info(...formatLogArgs(logger, args));
}

export function logWarn(logger: Logger | undefined, ...args: unknown[]): void {
  const formatted = formatLogArgs(logger, args);
  if (logger?.warn) {
    logger.warn(...formatted);
    return;
  }
  console.warn(...formatted);
}

export function logError(logger: Logger | undefined, ...args: unknown[]): void {
  const formatted = formatLogArgs(logger, args);
  if (logger?.error) {
    logger.error(...formatted);
    return;
  }
  console.error(...formatted);
}
