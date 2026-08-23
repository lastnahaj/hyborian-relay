export type RelayErrorCode =
  | "CONFIGURATION_INVALID"
  | "RCON_CONNECTION_FAILED"
  | "RCON_AUTHENTICATION_FAILED"
  | "RCON_COMMAND_TIMEOUT"
  | "RCON_PROTOCOL_ERROR"
  | "RCON_CHAT_TRANSPORT_UNAVAILABLE"
  | "RCON_QUEUE_FULL"
  | "DATABASE_OPEN_FAILED"
  | "DATABASE_MIGRATION_FAILED"
  | "PLAYER_LIST_PARSE_FAILED"
  | "INSTANCE_ALREADY_RUNNING";

export class RelayError extends Error {
  public readonly code: RelayErrorCode;

  public constructor(code: RelayErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RelayError";
    this.code = code;
  }
}

export function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
