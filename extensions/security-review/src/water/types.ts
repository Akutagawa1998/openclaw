// ─── Action Bundle (submitted by the Agent) ───

export type PlannedAction = {
  tool: string;
  params: Record<string, unknown>;
  expectedImpact: string;
  rollback?: string;
};

export type NetworkTarget = {
  domain?: string;
  ip?: string;
  port?: number;
  protocol?: string;
};

export type DownloadSource = {
  url: string;
  expectedChecksum?: string;
  packageManager?: string;
};

export type ActionBundle = {
  goal: string;
  actions: PlannedAction[];
  filePaths: string[];
  networkTargets?: NetworkTarget[];
  downloadSources?: DownloadSource[];
  sensitiveDataCategories?: string[];
};

// ─── Permit Token ───

export type PermitToken = {
  id: string;
  sessionId: string;
  runId: string;
  bundleHash: string;
  bundle: ActionBundle;
  grantedAt: number;
  expiresAt: number;
  consumedActions: Set<number>;
  reviewSummary: string;
  riskTags: string[];
};

// ─── SafeCheck Result ───

export type SafeCheckDecision = "approve" | "deny";

export type SafeCheckResult = {
  decision: SafeCheckDecision;
  summary: string;
  risks: string[];
  riskTags: string[];
  confidence: number;
  hardDenyRule?: string;
};

// ─── Bundle Match ───

export type BundleMatchResult = {
  matched: boolean;
  actionIndex?: number;
  driftWarnings: string[];
  driftErrors: string[];
};

// ─── Audit Log ───

export type AuditEntryType =
  | "bundle_submitted"
  | "bundle_hard_denied"
  | "bundle_reviewed"
  | "permit_granted"
  | "permit_denied"
  | "enforcement_allowed"
  | "enforcement_blocked_no_permit"
  | "enforcement_blocked_expired"
  | "enforcement_blocked_mismatch"
  | "enforcement_blocked_param_drift"
  | "enforcement_blocked_consumed"
  | "mode_switch";

export type AuditEntry = {
  ts: number;
  type: AuditEntryType;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  toolName?: string;
  permitId?: string;
  bundleHash?: string;
  detail: Record<string, unknown>;
};

// ─── Water Mode Config ───

export type WaterModeConfig = {
  permitTtlMs: number;
  safeCheckTimeoutMs: number;
  safeCheckModel: string;
  maxBundleActions: number;
  highRiskToolPatterns: string[];
  highRiskPathPatterns: string[];
  allowedDownloadDomains: string[];
};
