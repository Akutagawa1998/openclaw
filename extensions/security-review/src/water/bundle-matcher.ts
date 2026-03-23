import type { ActionBundle, BundleMatchResult } from "./types.js";

/**
 * Match a tool call against an approved action bundle.
 * Returns the best match (if any) among unconsumed actions.
 */
export function matchToolCallToBundle(
  toolName: string,
  toolParams: Record<string, unknown>,
  bundle: ActionBundle,
  consumedActions: Set<number>,
): BundleMatchResult {
  let bestMatch: BundleMatchResult | null = null;

  for (let i = 0; i < bundle.actions.length; i++) {
    if (consumedActions.has(i)) continue;

    const action = bundle.actions[i];
    if (action.tool !== toolName) continue;

    const result = matchParams(toolName, toolParams, action.params);
    result.actionIndex = i;

    if (result.matched && result.driftErrors.length === 0) {
      // Perfect or acceptable match — prefer fewer warnings
      if (!bestMatch || result.driftWarnings.length < bestMatch.driftWarnings.length) {
        bestMatch = result;
      }
    } else if (result.driftErrors.length > 0 && !bestMatch) {
      // Record drift errors for the block message
      bestMatch = result;
    }
  }

  return bestMatch ?? { matched: false, driftWarnings: [], driftErrors: [] };
}

function matchParams(
  toolName: string,
  actual: Record<string, unknown>,
  planned: Record<string, unknown>,
): BundleMatchResult {
  const driftWarnings: string[] = [];
  const driftErrors: string[] = [];

  if (toolName === "exec" || toolName === "bash") {
    return matchExecParams(actual, planned);
  }

  if (toolName === "write" || toolName === "edit" || toolName === "apply_patch") {
    return matchWriteParams(actual, planned);
  }

  // Generic matching for other tools: check all planned keys exist in actual
  for (const key of Object.keys(planned)) {
    const actualVal = actual[key];
    const plannedVal = planned[key];

    if (actualVal === undefined) {
      driftWarnings.push(`Missing planned param: ${key}`);
      continue;
    }

    if (isPathKey(key)) {
      // Path keys must match exactly
      if (String(actualVal) !== String(plannedVal)) {
        driftErrors.push(`${key}: expected "${String(plannedVal)}", got "${String(actualVal)}"`);
      }
    }
  }

  return {
    matched: driftErrors.length === 0,
    driftWarnings,
    driftErrors,
  };
}

function matchExecParams(
  actual: Record<string, unknown>,
  planned: Record<string, unknown>,
): BundleMatchResult {
  const driftWarnings: string[] = [];
  const driftErrors: string[] = [];

  const actualCmd = typeof actual.command === "string" ? actual.command.trim() : "";
  const plannedCmd = typeof planned.command === "string" ? planned.command.trim() : "";

  if (!actualCmd) {
    driftErrors.push("Empty exec command");
    return { matched: false, driftWarnings, driftErrors };
  }

  if (!plannedCmd) {
    driftErrors.push("Planned action has no command");
    return { matched: false, driftWarnings, driftErrors };
  }

  // Split compound commands
  const actualParts = splitCompoundCommand(actualCmd);
  const plannedParts = splitCompoundCommand(plannedCmd);

  // Each actual subcommand must match some planned subcommand
  for (const actualPart of actualParts) {
    const found = plannedParts.some((pp) => commandMatches(actualPart, pp));
    if (!found) {
      // Check if the actual part is a subset of the full planned command
      if (!commandMatches(actualPart, plannedCmd)) {
        driftErrors.push(`Exec subcommand not in approved plan: "${actualPart}"`);
      }
    }
  }

  // Check for new binaries not in the plan
  const actualBins = extractBinaries(actualCmd);
  const plannedBins = extractBinaries(plannedCmd);
  for (const bin of actualBins) {
    if (!plannedBins.has(bin)) {
      driftErrors.push(`New binary not in plan: "${bin}"`);
    }
  }

  return {
    matched: driftErrors.length === 0,
    driftWarnings,
    driftErrors,
  };
}

function matchWriteParams(
  actual: Record<string, unknown>,
  planned: Record<string, unknown>,
): BundleMatchResult {
  const driftWarnings: string[] = [];
  const driftErrors: string[] = [];

  // Path must match exactly
  const actualPath = extractPathValue(actual);
  const plannedPath = extractPathValue(planned);

  if (actualPath && plannedPath && actualPath !== plannedPath) {
    driftErrors.push(`File path mismatch: expected "${plannedPath}", got "${actualPath}"`);
  } else if (!actualPath && plannedPath) {
    driftErrors.push(`Missing file path (expected "${plannedPath}")`);
  }

  // Content is allowed to differ (bundle describes intent, not exact content)
  const actualContent = typeof actual.content === "string" ? actual.content : "";
  if (actualContent && containsSuspiciousPatterns(actualContent)) {
    driftWarnings.push("Content contains patterns matching exfiltration/secret access");
  }

  return {
    matched: driftErrors.length === 0,
    driftWarnings,
    driftErrors,
  };
}

// ─── Helpers ───

function splitCompoundCommand(cmd: string): string[] {
  // Split by &&, ||, ; — but not inside quotes
  return cmd
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function commandMatches(actual: string, planned: string): boolean {
  // Normalize whitespace
  const a = actual.replace(/\s+/g, " ").trim().toLowerCase();
  const p = planned.replace(/\s+/g, " ").trim().toLowerCase();
  // Exact match or actual is contained in planned
  return a === p || p.includes(a);
}

function extractBinaries(cmd: string): Set<string> {
  const bins = new Set<string>();
  const parts = splitCompoundCommand(cmd);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    if (tokens[0]) {
      // Get the basename (e.g., /usr/bin/node → node)
      const base = tokens[0].split("/").pop()!;
      bins.add(base.toLowerCase());
    }
  }
  return bins;
}

function extractPathValue(params: Record<string, unknown>): string | undefined {
  const p = params.file_path ?? params.path ?? params.filePath;
  return typeof p === "string" ? p : undefined;
}

function isPathKey(key: string): boolean {
  return /^(file_?path|path|file|target|source)$/i.test(key);
}

const SUSPICIOUS_PATTERNS = [
  /\bcurl\b.*-[dX]/i,
  /\bwget\b.*--post/i,
  /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)\w*\}?/i,
  /\/proc\/\d+\/environ/,
  /\/proc\/self\/environ/,
];

function containsSuspiciousPatterns(content: string): boolean {
  return SUSPICIOUS_PATTERNS.some((p) => p.test(content));
}
