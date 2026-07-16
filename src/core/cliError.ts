import { log } from "./logger.ts";

// Commander doesn't catch rejected promises from async .action() handlers,
// so an uncaught error prints Bun's raw stack trace instead of a clean CLI
// message. Wrap every command action with this so failures (missing flags,
// bad specs, network errors, port conflicts, ...) print one readable line
// and exit 1 — set SHIMWIRE_DEBUG=1 to see the full stack when you need it.
export function withErrorHandling<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await action(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Error: ${message}`);
      if (process.env.SHIMWIRE_DEBUG && err instanceof Error && err.stack) {
        log.dim(err.stack);
      }
      process.exitCode = 1;
    }
  };
}
