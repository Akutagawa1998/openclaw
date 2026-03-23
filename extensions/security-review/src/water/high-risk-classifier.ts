import type { WaterModeConfig } from "./types.js";

// Safe exec commands that bypass high-risk check (same as Ice Mode allowlist)
const SAFE_EXEC_COMMANDS = [
  /^\/home\/node\/\.openclaw\/scripts\/security-check\.sh$/,
  /^(ls|pwd|whoami|date|uname|cat\s+\/etc\/os-release)$/,
  /^echo\s+"[^$`]*"$/,
];

/**
 * Determine if a tool call is high-risk and requires a permit in Water Mode.
 * Non-high-risk calls are allowed through without a permit.
 */
export function isHighRisk(
  toolName: string,
  params: Record<string, unknown>,
  config: WaterModeConfig,
): boolean {
  // exec / bash — always high-risk unless in safe allowlist
  if (config.highRiskToolPatterns.includes(toolName)) {
    if (toolName === "exec" || toolName === "bash") {
      const command = typeof params.command === "string" ? params.command.trim() : "";
      // Check safe exec allowlist
      for (const pattern of SAFE_EXEC_COMMANDS) {
        if (pattern.test(command)) {
          return false; // safe, no permit needed
        }
      }
    }
    return true;
  }

  // write / edit — high-risk only if targeting sensitive paths
  if (toolName === "write" || toolName === "edit" || toolName === "apply_patch") {
    const filePath = extractPath(params);
    if (filePath) {
      for (const pattern of config.highRiskPathPatterns) {
        if (new RegExp(pattern, "i").test(filePath)) {
          return true;
        }
      }
    }
    return false; // normal write within workspace
  }

  return false;
}

function extractPath(params: Record<string, unknown>): string | undefined {
  const p = params.file_path ?? params.path ?? params.filePath ?? params.pattern;
  return typeof p === "string" ? p : undefined;
}
