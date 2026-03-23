import fs from "node:fs";
import path from "node:path";
import type { AuditEntry } from "./types.js";

let logFd: number | null = null;
let logPath: string | null = null;

// In-memory ring buffer for /sec_audit command
const recentEntries: AuditEntry[] = [];
const MAX_RECENT = 200;

export function initAuditLog(stateDir: string): void {
  try {
    const logsDir = path.join(stateDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    logPath = path.join(logsDir, "security-audit.jsonl");
    logFd = fs.openSync(logPath, "a");
  } catch {
    // Non-fatal: audit log is optional (read-only FS etc.)
    logFd = null;
  }
}

export function writeAuditEntry(entry: AuditEntry): void {
  // Always store in memory
  recentEntries.unshift(entry);
  if (recentEntries.length > MAX_RECENT) {
    recentEntries.length = MAX_RECENT;
  }

  // Write to disk if available
  if (logFd !== null) {
    try {
      const line = JSON.stringify(entry) + "\n";
      fs.writeSync(logFd, line);
    } catch {
      // Swallow write errors (disk full, EROFS, etc.)
    }
  }
}

export function getRecentEntries(count: number = 20): AuditEntry[] {
  return recentEntries.slice(0, count);
}

export function getLogPath(): string | null {
  return logPath;
}
