/**
 * Structured-logging port (Slice-post-PR §2). Application/domain code depends on
 * THIS, never on the infrastructure pino logger directly — the architecture
 * boundary (and the `boundaries` test) forbids the application layer from
 * importing infrastructure. The composition root binds a pino-backed adapter at
 * startup via `setAppLogger`; until then a no-op is used, so unit tests stay
 * silent and network-free.
 *
 * The signature mirrors pino: an object of safe context first, then a message.
 * Callers must pass only redaction-safe context (ids, codes, outcomes) — never
 * raw PII, tokens, SQL parameters or provider payloads.
 */
export interface ILogger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}
