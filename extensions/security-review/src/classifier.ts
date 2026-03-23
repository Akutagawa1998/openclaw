import type { SecurityReviewConfig, ClassifierResult } from "./types.js";

// Exec patterns that indicate data exfiltration
const EXFIL_PATTERNS = [
  /\bcurl\b.*\s-[dX]/i, // curl with POST data
  /\bcurl\b.*--data/i,
  /\bwget\b.*--post/i,
  /\bnc\b.*-[ecl]/i, // netcat reverse/listen
  /\bnetcat\b/i,
  /\bncat\b/i,
  /\bsocat\b/i,
  /\bssh\b.*-R/i, // SSH reverse tunnel
  /\bscp\b/i,
  /\brsync\b/i,
  /\bftp\b/i,
  /\btftp\b/i,
  />\s*\/dev\/tcp\//i, // bash /dev/tcp redirect
];

// Exec patterns that read secrets from environment
const ENV_SECRET_PATTERNS = [
  /\benv\b/,
  /\bprintenv\b/,
  /\bset\b\s*$/m,
  /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)\w*\}?/i,
  /\becho\b.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/i,
  /\/proc\/\d+\/environ/,
  /\/proc\/self\/environ/,
];

// Destructive commands
const DESTRUCTIVE_PATTERNS = [
  /\brm\b.*-[rR]f/,
  /\brm\b.*-f[rR]/,
  /\bdd\b.*of=/,
  /\bmkfs\b/,
  /\bshred\b/,
  /\bkill\b.*-9/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\bchmod\b.*777/,
  /\bchown\b.*root/,
];

// Privilege escalation
const PRIVESC_PATTERNS = [
  /\bsudo\b/,
  /\bsu\b\s+-/,
  /\bchroot\b/,
  /\bunshare\b/,
  /\bnsenter\b/,
  /\bcapsh\b/,
  /\bsetcap\b/,
];

// Allowlisted exec commands (always safe)
const SAFE_EXEC_COMMANDS = [
  /^\/home\/node\/\.openclaw\/scripts\/security-check\.sh$/,
  /^(ls|pwd|whoami|date|uname|cat\s+\/etc\/os-release)$/,
  /^echo\s+"[^$`]*"$/,  // echo with literal string only (no variable expansion)
];

const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "web_search", "web_fetch"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const MEMORY_TOOLS = new Set(["memory_read", "memory_write", "memory_search"]);

export function classify(
  toolName: string,
  params: Record<string, unknown>,
  config: SecurityReviewConfig,
): ClassifierResult {
  // Exempt tools skip all checks
  if (config.exemptTools.includes(toolName)) {
    return { level: "safe", reason: "Exempt tool" };
  }

  // Read-only tools
  if (READ_ONLY_TOOLS.has(toolName)) {
    return classifyReadTool(toolName, params, config);
  }

  // Write tools
  if (WRITE_TOOLS.has(toolName)) {
    return classifyWriteTool(toolName, params, config);
  }

  // Memory tools
  if (MEMORY_TOOLS.has(toolName)) {
    return { level: "safe", reason: "Memory tool (sandboxed)" };
  }

  // Exec tool — most scrutiny
  if (toolName === "exec" || toolName === "bash") {
    return classifyExec(params, config);
  }

  // Unknown tool → needs review
  return { level: "review", reason: `Unknown tool: ${toolName}` };
}

function classifyReadTool(
  _toolName: string,
  params: Record<string, unknown>,
  config: SecurityReviewConfig,
): ClassifierResult {
  const path = extractPath(params);
  if (!path) return { level: "safe", reason: "Read tool, no path" };

  // Check if path matches sensitive patterns
  for (const pattern of config.blockPathPatterns) {
    if (new RegExp(pattern, "i").test(path)) {
      return { level: "review", reason: `Read targets sensitive path: ${path}` };
    }
  }

  // Safe if within workspace
  if (isInSafePath(path, config.safeReadPatterns)) {
    return { level: "safe", reason: "Read within workspace" };
  }

  return { level: "review", reason: `Read outside workspace: ${path}` };
}

function classifyWriteTool(
  _toolName: string,
  params: Record<string, unknown>,
  config: SecurityReviewConfig,
): ClassifierResult {
  const path = extractPath(params);
  if (!path) return { level: "review", reason: "Write tool, no path specified" };

  // Writes to sensitive paths are always unsafe
  for (const pattern of config.blockPathPatterns) {
    if (new RegExp(pattern, "i").test(path)) {
      return { level: "unsafe", reason: `Write targets sensitive path: ${path}` };
    }
  }

  // Safe if within workspace
  if (isInSafePath(path, config.safeReadPatterns)) {
    return { level: "safe", reason: "Write within workspace" };
  }

  return { level: "unsafe", reason: `Write outside workspace: ${path}` };
}

function classifyExec(
  params: Record<string, unknown>,
  config: SecurityReviewConfig,
): ClassifierResult {
  const command = typeof params.command === "string" ? params.command : "";
  if (!command.trim()) {
    return { level: "review", reason: "Empty exec command" };
  }

  // Check allowlisted commands first
  for (const pattern of SAFE_EXEC_COMMANDS) {
    if (pattern.test(command.trim())) {
      return { level: "safe", reason: "Allowlisted exec command" };
    }
  }

  // Data exfiltration
  for (const pattern of EXFIL_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "unsafe", reason: `Potential data exfiltration: ${pattern.source}` };
    }
  }

  // Environment secret access
  for (const pattern of ENV_SECRET_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "unsafe", reason: `Potential secret access: ${pattern.source}` };
    }
  }

  // Destructive operations
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "unsafe", reason: `Destructive command: ${pattern.source}` };
    }
  }

  // Privilege escalation
  for (const pattern of PRIVESC_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "unsafe", reason: `Privilege escalation: ${pattern.source}` };
    }
  }

  // Everything else needs Claude API review
  return { level: "review", reason: "Exec command needs review" };
}

function extractPath(params: Record<string, unknown>): string | undefined {
  // Various tool param names for file paths
  const path =
    params.file_path ?? params.path ?? params.filePath ?? params.pattern ?? params.glob;
  return typeof path === "string" ? path : undefined;
}

function isInSafePath(path: string, safePatterns: string[]): boolean {
  return safePatterns.some((safe) => path.startsWith(safe));
}
