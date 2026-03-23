import type { ActionBundle, PermitToken, BundleMatchResult } from "./types.js";
import { matchToolCallToBundle } from "./bundle-matcher.js";

const permits = new Map<string, PermitToken>();
let counter = 0;

function generateId(): string {
  counter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `wpt-${rand}${counter}`;
}

export function grantPermit(params: {
  sessionId: string;
  runId: string;
  bundle: ActionBundle;
  bundleHash: string;
  ttlMs: number;
  reviewSummary: string;
  riskTags: string[];
}): PermitToken {
  const now = Date.now();
  const token: PermitToken = {
    id: generateId(),
    sessionId: params.sessionId,
    runId: params.runId,
    bundleHash: params.bundleHash,
    bundle: params.bundle,
    grantedAt: now,
    expiresAt: now + params.ttlMs,
    consumedActions: new Set(),
    reviewSummary: params.reviewSummary,
    riskTags: params.riskTags,
  };
  permits.set(token.id, token);
  return token;
}

export function findValidPermit(params: {
  sessionId: string;
  runId: string;
  toolName: string;
  toolParams: Record<string, unknown>;
}): { permit: PermitToken; matchResult: BundleMatchResult } | null {
  const now = Date.now();

  for (const permit of permits.values()) {
    // Must match session and run
    if (permit.sessionId !== params.sessionId || permit.runId !== params.runId) {
      continue;
    }
    // Must not be expired
    if (permit.expiresAt <= now) {
      continue;
    }
    // Try to match tool call against bundle actions
    const matchResult = matchToolCallToBundle(
      params.toolName,
      params.toolParams,
      permit.bundle,
      permit.consumedActions,
    );
    if (matchResult.matched) {
      return { permit, matchResult };
    }
  }

  return null;
}

export function markActionConsumed(permitId: string, actionIndex: number): void {
  const permit = permits.get(permitId);
  if (permit) {
    permit.consumedActions.add(actionIndex);
  }
}

export function revokeExpired(): number {
  const now = Date.now();
  let count = 0;
  for (const [id, permit] of permits) {
    if (permit.expiresAt <= now) {
      permits.delete(id);
      count++;
    }
  }
  return count;
}

export function revokeAll(): void {
  permits.clear();
}

export function revokeById(id: string): boolean {
  return permits.delete(id);
}

export function getActivePermits(): PermitToken[] {
  const now = Date.now();
  return [...permits.values()].filter((p) => p.expiresAt > now);
}

export function getPermitById(id: string): PermitToken | undefined {
  return permits.get(id);
}
