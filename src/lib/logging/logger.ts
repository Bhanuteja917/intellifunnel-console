type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields: Fields): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields }));
}

export const logger = {
  debug: (message: string, fields: Fields = {}) => emit("debug", message, fields),
  info: (message: string, fields: Fields = {}) => emit("info", message, fields),
  warn: (message: string, fields: Fields = {}) => emit("warn", message, fields),
  error: (message: string, fields: Fields = {}) => emit("error", message, fields),
};
