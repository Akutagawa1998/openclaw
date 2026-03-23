import type { SecurityReviewConfig, SecurityMode, WaterModeConfig } from "./types.js";

const WATER_DEFAULTS: WaterModeConfig = {
  permitTtlMs: 300_000,
  safeCheckTimeoutMs: 45_000,
  safeCheckModel: "claude-sonnet-4-20250514",
  maxBundleActions: 20,
  highRiskToolPatterns: ["exec", "bash"],
  highRiskPathPatterns: [
    "\\.openclaw/skills/",
    "SKILL\\.md",
    "openclaw\\.json",
    "docker-compose",
    "exec-approvals",
  ],
  allowedDownloadDomains: [],
};

const DEFAULTS: SecurityReviewConfig = {
  enabled: true,
  securityMode: "ice",
  reviewModel: "claude-sonnet-4-20250514",
  maxReviewTimeoutMs: 30_000,
  approvalTimeoutMs: 300_000,
  notifyChannel: "telegram",
  notifyTo: "",
  exemptTools: [],
  safeReadPatterns: ["/home/node/.openclaw/workspace/"],
  blockPathPatterns: ["\\.env$", "credentials", "secrets\\.enc", "\\.key$", "\\.pem$"],
  blockEnvPatterns: ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "PRIVATE"],
  water: { ...WATER_DEFAULTS },
};

export function parseConfig(raw?: Record<string, unknown>): SecurityReviewConfig {
  if (!raw) return { ...DEFAULTS, water: { ...WATER_DEFAULTS } };

  const securityMode = parseSecurityMode(raw.securityMode);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
    securityMode,
    reviewModel: typeof raw.reviewModel === "string" ? raw.reviewModel : DEFAULTS.reviewModel,
    maxReviewTimeoutMs:
      typeof raw.maxReviewTimeoutMs === "number"
        ? raw.maxReviewTimeoutMs
        : DEFAULTS.maxReviewTimeoutMs,
    approvalTimeoutMs:
      typeof raw.approvalTimeoutMs === "number"
        ? raw.approvalTimeoutMs
        : DEFAULTS.approvalTimeoutMs,
    notifyChannel:
      typeof raw.notifyChannel === "string" ? raw.notifyChannel : DEFAULTS.notifyChannel,
    notifyTo: typeof raw.notifyTo === "string" ? raw.notifyTo : DEFAULTS.notifyTo,
    exemptTools: Array.isArray(raw.exemptTools) ? raw.exemptTools : DEFAULTS.exemptTools,
    safeReadPatterns: Array.isArray(raw.safeReadPatterns)
      ? raw.safeReadPatterns
      : DEFAULTS.safeReadPatterns,
    blockPathPatterns: Array.isArray(raw.blockPathPatterns)
      ? raw.blockPathPatterns
      : DEFAULTS.blockPathPatterns,
    blockEnvPatterns: Array.isArray(raw.blockEnvPatterns)
      ? raw.blockEnvPatterns
      : DEFAULTS.blockEnvPatterns,
    water: parseWaterConfig(raw.water),
  };
}

function parseSecurityMode(value: unknown): SecurityMode {
  if (value === "water") return "water";
  return "ice";
}

function parseWaterConfig(raw: unknown): WaterModeConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...WATER_DEFAULTS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    permitTtlMs:
      typeof obj.permitTtlMs === "number" ? obj.permitTtlMs : WATER_DEFAULTS.permitTtlMs,
    safeCheckTimeoutMs:
      typeof obj.safeCheckTimeoutMs === "number"
        ? obj.safeCheckTimeoutMs
        : WATER_DEFAULTS.safeCheckTimeoutMs,
    safeCheckModel:
      typeof obj.safeCheckModel === "string"
        ? obj.safeCheckModel
        : WATER_DEFAULTS.safeCheckModel,
    maxBundleActions:
      typeof obj.maxBundleActions === "number"
        ? obj.maxBundleActions
        : WATER_DEFAULTS.maxBundleActions,
    highRiskToolPatterns: Array.isArray(obj.highRiskToolPatterns)
      ? obj.highRiskToolPatterns
      : WATER_DEFAULTS.highRiskToolPatterns,
    highRiskPathPatterns: Array.isArray(obj.highRiskPathPatterns)
      ? obj.highRiskPathPatterns
      : WATER_DEFAULTS.highRiskPathPatterns,
    allowedDownloadDomains: Array.isArray(obj.allowedDownloadDomains)
      ? obj.allowedDownloadDomains
      : WATER_DEFAULTS.allowedDownloadDomains,
  };
}
