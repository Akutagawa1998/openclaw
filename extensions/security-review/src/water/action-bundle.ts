import crypto from "node:crypto";
import type { ActionBundle } from "./types.js";

const MAX_GOAL_LEN = 500;
const MAX_ACTIONS = 20;
const MAX_FILE_PATHS = 50;
const MAX_PATH_LEN = 500;
const MAX_NETWORK_TARGETS = 20;
const MAX_DOWNLOAD_SOURCES = 20;
const VALID_SENSITIVE_CATEGORIES = new Set([
  "api_keys",
  "credentials",
  "env_vars",
  "private_keys",
  "tokens",
  "passwords",
  "pii",
  "financial",
]);

export function validateBundle(
  raw: unknown,
): { valid: true; bundle: ActionBundle } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["Bundle must be an object"] };
  }

  const obj = raw as Record<string, unknown>;

  // goal
  if (typeof obj.goal !== "string" || !obj.goal.trim()) {
    errors.push("goal must be a non-empty string");
  } else if (obj.goal.length > MAX_GOAL_LEN) {
    errors.push(`goal exceeds ${MAX_GOAL_LEN} chars`);
  }

  // actions
  if (!Array.isArray(obj.actions) || obj.actions.length === 0) {
    errors.push("actions must be a non-empty array");
  } else if (obj.actions.length > MAX_ACTIONS) {
    errors.push(`actions exceeds max ${MAX_ACTIONS}`);
  } else {
    for (let i = 0; i < obj.actions.length; i++) {
      const a = obj.actions[i] as Record<string, unknown>;
      if (!a || typeof a !== "object") {
        errors.push(`actions[${i}] must be an object`);
        continue;
      }
      if (typeof a.tool !== "string" || !a.tool.trim()) {
        errors.push(`actions[${i}].tool must be a non-empty string`);
      }
      if (!a.params || typeof a.params !== "object" || Array.isArray(a.params)) {
        errors.push(`actions[${i}].params must be an object`);
      }
      if (typeof a.expectedImpact !== "string" || !a.expectedImpact.trim()) {
        errors.push(`actions[${i}].expectedImpact must be a non-empty string`);
      }
    }
  }

  // filePaths
  if (!Array.isArray(obj.filePaths)) {
    errors.push("filePaths must be an array");
  } else if (obj.filePaths.length > MAX_FILE_PATHS) {
    errors.push(`filePaths exceeds max ${MAX_FILE_PATHS}`);
  } else {
    for (const p of obj.filePaths) {
      if (typeof p !== "string" || p.length > MAX_PATH_LEN) {
        errors.push(`filePaths entry invalid or exceeds ${MAX_PATH_LEN} chars`);
        break;
      }
    }
  }

  // networkTargets (optional)
  if (obj.networkTargets !== undefined) {
    if (!Array.isArray(obj.networkTargets)) {
      errors.push("networkTargets must be an array");
    } else if (obj.networkTargets.length > MAX_NETWORK_TARGETS) {
      errors.push(`networkTargets exceeds max ${MAX_NETWORK_TARGETS}`);
    }
  }

  // downloadSources (optional)
  if (obj.downloadSources !== undefined) {
    if (!Array.isArray(obj.downloadSources)) {
      errors.push("downloadSources must be an array");
    } else if (obj.downloadSources.length > MAX_DOWNLOAD_SOURCES) {
      errors.push(`downloadSources exceeds max ${MAX_DOWNLOAD_SOURCES}`);
    }
  }

  // sensitiveDataCategories (optional)
  if (obj.sensitiveDataCategories !== undefined) {
    if (!Array.isArray(obj.sensitiveDataCategories)) {
      errors.push("sensitiveDataCategories must be an array");
    } else {
      for (const cat of obj.sensitiveDataCategories) {
        if (typeof cat !== "string" || !VALID_SENSITIVE_CATEGORIES.has(cat)) {
          errors.push(
            `Invalid sensitive category "${String(cat)}". Valid: ${[...VALID_SENSITIVE_CATEGORIES].join(", ")}`,
          );
          break;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, bundle: obj as unknown as ActionBundle };
}

/**
 * Produce a deterministic SHA-256 hash of the bundle by sorting keys recursively.
 */
export function canonicalBundleHash(bundle: ActionBundle): string {
  const canonical = JSON.stringify(sortKeysDeep(bundle));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
