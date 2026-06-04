import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";

export type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export function createLogger(config: AppConfig): Logger {
  mkdirSync(config.localLogPath, { recursive: true });

  const logFilePath = join(config.localLogPath, `${getDateStamp(new Date())}-run.log`);

  return {
    info: (message, context) => writeLog(logFilePath, "info", message, context),
    error: (message, context) => writeLog(logFilePath, "error", message, context),
  };
}

function writeLog(
  logFilePath: string,
  level: "info" | "error",
  message: string,
  context?: Record<string, unknown>,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: context ?? {},
  };

  appendFileSync(logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  console.log(`[${level}] ${message}`);
}

function getDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
