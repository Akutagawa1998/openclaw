export type RiskLevel = "safe" | "unsafe" | "review";

export type ReviewDecision = "safe" | "unsafe" | "needs_approval";

export type ClassifierResult = {
  level: RiskLevel;
  reason: string;
};

export type ReviewResult = {
  decision: ReviewDecision;
  summary: string;
  risks: string[];
  confidence: number;
};

export type PendingApproval = {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  risks: string[];
  summary: string;
  createdAt: number;
  resolve: (approved: boolean) => void;
};

export type SecurityMode = "ice" | "water";

export type WaterModeConfig = {
  permitTtlMs: number;
  safeCheckTimeoutMs: number;
  safeCheckModel: string;
  maxBundleActions: number;
  highRiskToolPatterns: string[];
  highRiskPathPatterns: string[];
  allowedDownloadDomains: string[];
};

export type SecurityReviewConfig = {
  enabled: boolean;
  securityMode: SecurityMode;
  reviewModel: string;
  maxReviewTimeoutMs: number;
  approvalTimeoutMs: number;
  notifyChannel: string;
  notifyTo: string;
  exemptTools: string[];
  safeReadPatterns: string[];
  blockPathPatterns: string[];
  blockEnvPatterns: string[];
  water: WaterModeConfig;
};

export type SecurityStats = {
  totalChecks: number;
  autoApproved: number;
  autoBlocked: number;
  sentForReview: number;
  humanApproved: number;
  humanDenied: number;
  timedOut: number;
};
